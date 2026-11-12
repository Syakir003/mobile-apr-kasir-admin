import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import '../members/member_providers.dart';
import 'job_providers.dart';
import 'technician_multi_picker.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';

/// Jenis pekerjaan Terima Servis (sama dengan web; pemasangan berasal dari POS, tidak ditawarkan di sini).
enum IntakeJobType {
  perbaikan('perbaikan', 'Perbaikan'),
  cuci('cuci', 'Cuci AC'),
  maintenance('maintenance', 'Maintenance'),
  bongkar('bongkar', 'Bongkar AC'),
  pasang('pasang', 'Pasang AC'),
  bongkarPasang('bongkar_pasang', 'Bongkar Pasang AC');

  const IntakeJobType(this.value, this.label);
  final String value;
  final String label;
}

/// Unit AC baru yang diinput langsung di form (belum terdaftar). Mode [qrDulu]: merk/PK diisi teknisi saat scan.
class IntakeNewUnit {
  IntakeNewUnit({this.brand = '', this.model = '', this.pk, this.room = '', this.qrDulu = false});
  String brand;
  String model;
  num? pk;
  String room;
  bool qrDulu;
}

/// Muatan `POST /service-orders/intake` (sama dengan form web): pelanggan lama (memberId) atau baru (nama + HP),
/// unit lama dan/atau baru, jenis pekerjaan, keluhan (wajib), jadwal (wajib, YYYY-MM-DD), teknisi.
Map<String, dynamic> buildIntakePayload({
  String? memberId,
  String? memberName,
  String name = '',
  String phone = '',
  String address = '',
  required IntakeJobType jobType,
  String workDescription = '',
  required String complaint,
  required DateTime scheduled,
  List<String> technicianIds = const [],
  Iterable<String> existingUnitIds = const [],
  List<IntakeNewUnit> newUnits = const [],
}) {
  String two(int n) => n.toString().padLeft(2, '0');
  String? opt(String v) => v.trim().isEmpty ? null : v.trim();
  return {
    'customer': memberId != null
        ? {'name': memberName ?? '', 'memberId': memberId}
        : {'name': name.trim(), 'phone': phone.trim(), if (opt(address) != null) 'address': opt(address)},
    'jobType': jobType.value,
    if (opt(workDescription) != null) 'workDescription': opt(workDescription),
    'complaint': complaint.trim(),
    'scheduledDate': '${scheduled.year}-${two(scheduled.month)}-${two(scheduled.day)}',
    if (technicianIds.isNotEmpty) 'technicianIds': technicianIds,
    'units': [
      for (final id in existingUnitIds) {'existingUnitId': id},
      for (final u in newUnits)
        {
          'newUnit': u.qrDulu
              // Mode QR dulu: server menolak merk/model/PK bila ikut terkirim.
              ? {'qrDulu': true, if (opt(u.room) != null) 'roomLocation': opt(u.room)}
              : {
                  if (opt(u.brand) != null) 'brand': opt(u.brand),
                  if (opt(u.model) != null) 'model': opt(u.model),
                  if (u.pk != null) 'pk': u.pk,
                  if (opt(u.room) != null) 'roomLocation': opt(u.room),
                },
        },
    ],
  };
}

/// Form Terima Servis (admin/kasir), setara halaman web: pelanggan lama atau baru, unit AC lama/baru, jenis
/// pekerjaan, keluhan, jadwal, dan teknisi. Menulis lewat `POST /service-orders/intake`. Harga ditetapkan
/// kemudian dari kartu Harga Jasa & Tagihan di halaman job.
class ServiceOrderCreateScreen extends ConsumerStatefulWidget {
  const ServiceOrderCreateScreen({super.key});

  @override
  ConsumerState<ServiceOrderCreateScreen> createState() =>
      _ServiceOrderCreateScreenState();
}

class _NewUnitEditor {
  final brand = TextEditingController();
  final model = TextEditingController();
  final pk = TextEditingController();
  final room = TextEditingController();
  bool qrDulu = false;

  num? get pkValue => num.tryParse(pk.text.trim().replaceAll(',', '.'));
  bool get pkValid => pk.text.trim().isEmpty || (pkValue != null && pkValue! >= 0 && pkValue! <= 99.99);
  IntakeNewUnit toUnit() =>
      IntakeNewUnit(brand: brand.text, model: model.text, pk: pkValue, room: room.text, qrDulu: qrDulu);
  void dispose() {
    brand.dispose();
    model.dispose();
    pk.dispose();
    room.dispose();
  }
}

class _ServiceOrderCreateScreenState
    extends ConsumerState<ServiceOrderCreateScreen> {
  bool _newCustomer = false;
  String? _memberId;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _unitIds = <String>{};
  final _newUnits = <_NewUnitEditor>[];
  IntakeJobType _type = IntakeJobType.perbaikan;
  List<String> _technicianIds = const [];
  DateTime? _scheduled;
  final _workDesc = TextEditingController();
  final _complaint = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _phone, _address, _workDesc, _complaint]) {
      c.dispose();
    }
    for (final u in _newUnits) {
      u.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _scheduled ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _scheduled = picked);
  }

  bool get _customerOk =>
      _newCustomer ? _name.text.trim().isNotEmpty && _phone.text.trim().isNotEmpty : _memberId != null;
  int get _unitCount => (_newCustomer ? 0 : _unitIds.length) + _newUnits.length;
  bool get _canSubmit =>
      !_busy &&
      _customerOk &&
      _unitCount > 0 &&
      _complaint.text.trim().isNotEmpty &&
      _scheduled != null &&
      _newUnits.every((u) => u.pkValid);

  Future<void> _submit(List<Member> members) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    try {
      final member = _newCustomer ? null : members.where((m) => m.id == _memberId).firstOrNull;
      await ref.read(createServiceOrderCallerProvider)(buildIntakePayload(
        memberId: member?.id,
        memberName: member?.name,
        name: _name.text,
        phone: _phone.text,
        address: _address.text,
        jobType: _type,
        workDescription: _workDesc.text,
        complaint: _complaint.text,
        scheduled: _scheduled!,
        technicianIds: _technicianIds,
        existingUnitIds: _newCustomer ? const [] : _unitIds,
        newUnits: [for (final u in _newUnits) u.toUnit()],
      ));
      ref.invalidate(ordersProvider);
      ref.invalidate(jobsForCurrentUserProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('Order service dibuat.')),
      );
      router.pop();
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text(errorMessage(e)),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final membersAsync = ref.watch(membersStreamProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Terima Servis')),
      body: membersAsync.when(
        loading: () => const AppSkeletonDetail(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat member'),
        data: (members) {
          final active = members.where((m) => m.active).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              _label('Data Pelanggan'),
              SegmentedButton<bool>(
                key: const Key('order-customer-mode'),
                segments: const [
                  ButtonSegment(value: false, label: Text('Member lama')),
                  ButtonSegment(value: true, label: Text('Pelanggan baru')),
                ],
                selected: {_newCustomer},
                onSelectionChanged: _busy ? null : (v) => setState(() => _newCustomer = v.first),
              ),
              const SizedBox(height: 12),
              if (!_newCustomer)
                DropdownButtonFormField<String>(
                  key: const Key('order-member'),
                  initialValue: _memberId,
                  isExpanded: true,
                  decoration: const InputDecoration(hintText: 'Pilih member'),
                  items: [
                    for (final Member m in active)
                      DropdownMenuItem(
                        value: m.id,
                        child: Text('${m.name} · ${m.phone}',
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: _busy
                      ? null
                      : (v) => setState(() {
                            _memberId = v;
                            _unitIds.clear();
                          }),
                )
              else ...[
                TextField(
                  key: const Key('order-name'),
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Nama pelanggan'),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('order-phone'),
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'No. HP', hintText: 'Mis. 0855xxxxxxxx'),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _address,
                  maxLines: 2,
                  decoration: const InputDecoration(labelText: 'Alamat (opsional)'),
                ),
              ],
              const SizedBox(height: 16),
              _label('Unit AC'),
              if (!_newCustomer) ...[
                if (_memberId == null)
                  const _Hint('Pilih member dulu untuk melihat unit AC-nya, atau tambah unit baru di bawah.')
                else
                  _UnitPicker(
                    memberId: _memberId!,
                    selected: _unitIds,
                    onToggle: (id, on) => setState(() {
                      if (on) {
                        _unitIds.add(id);
                      } else {
                        _unitIds.remove(id);
                      }
                    }),
                  ),
                const SizedBox(height: 8),
              ],
              for (var i = 0; i < _newUnits.length; i++) _newUnitCard(i),
              OutlinedButton.icon(
                key: const Key('order-add-unit'),
                onPressed: _busy ? null : () => setState(() => _newUnits.add(_NewUnitEditor())),
                icon: const Icon(Icons.add),
                label: const Text('Tambah unit AC baru'),
              ),
              const SizedBox(height: 16),
              _label('Jenis Pekerjaan'),
              DropdownButtonFormField<IntakeJobType>(
                key: const Key('order-type'),
                initialValue: _type,
                decoration: const InputDecoration(),
                items: [
                  for (final t in IntakeJobType.values)
                    DropdownMenuItem(value: t, child: Text(t.label)),
                ],
                onChanged: _busy ? null : (v) => setState(() => _type = v!),
              ),
              const SizedBox(height: 16),
              _label('Deskripsi Pekerjaan (opsional)'),
              TextField(
                controller: _workDesc,
                maxLines: 2,
                decoration: const InputDecoration(
                  hintText: 'Mis. Cuci AC rutin semua unit, ganti kapasitor',
                ),
              ),
              const SizedBox(height: 16),
              _label('Keluhan Awal'),
              TextField(
                key: const Key('order-complaint'),
                controller: _complaint,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: 'Mis. AC tidak dingin, bunyi berisik (servis rutin: isi pekerjaannya, mis. Cuci AC)',
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 16),
              _label('Jadwal'),
              OutlinedButton.icon(
                key: const Key('order-date'),
                onPressed: _busy ? null : _pickDate,
                icon: const Icon(Icons.event_outlined),
                label: Text(_scheduled == null
                    ? 'Pilih tanggal'
                    : _formatDate(_scheduled!)),
              ),
              const SizedBox(height: 16),
              _label('Teknisi (opsional)'),
              TechnicianMultiPicker(
                value: _technicianIds,
                enabled: !_busy,
                onChanged: (v) => setState(() => _technicianIds = v),
              ),
              const SizedBox(height: 8),
              const _Hint('Harga ditetapkan nanti dari halaman job (Harga Jasa & Tagihan).'),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton.icon(
                  key: const Key('order-submit'),
                  onPressed: _canSubmit ? () => _submit(members) : null,
                  icon: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check),
                  label: Text(_unitCount == 0
                      ? 'Buat Order'
                      : 'Buat Order ($_unitCount unit)'),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _newUnitCard(int i) {
    final u = _newUnits[i];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(children: [
              Expanded(
                child: Text('Unit baru ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              IconButton(
                tooltip: 'Hapus unit',
                onPressed: _busy ? null : () => setState(() => _newUnits.removeAt(i).dispose()),
                icon: const Icon(Icons.delete_outline),
              ),
            ]),
            SwitchListTile(
              key: Key('order-unit-qr-$i'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('QR dulu (tipe AC diisi teknisi)'),
              value: u.qrDulu,
              onChanged: _busy ? null : (v) => setState(() => u.qrDulu = v),
            ),
            if (!u.qrDulu) ...[
              Row(children: [
                Expanded(child: TextField(controller: u.brand, decoration: const InputDecoration(labelText: 'Merek', isDense: true))),
                const SizedBox(width: 8),
                Expanded(child: TextField(controller: u.model, decoration: const InputDecoration(labelText: 'Model', isDense: true))),
              ]),
              const SizedBox(height: 8),
              TextField(
                controller: u.pk,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'PK',
                  isDense: true,
                  errorText: u.pkValid ? null : 'PK 0 – 99,99',
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
            ],
            TextField(
              controller: u.room,
              decoration: const InputDecoration(labelText: 'Lokasi ruangan (opsional)', isDense: true),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(
                fontWeight: FontWeight.w600, color: AppColors.slate700)),
      );
}

/// Daftar unit AC member sebagai checkbox multi-pilih.
class _UnitPicker extends ConsumerWidget {
  const _UnitPicker({
    required this.memberId,
    required this.selected,
    required this.onToggle,
  });

  final String memberId;
  final Set<String> selected;
  final void Function(String id, bool on) onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unitsAsync = ref.watch(memberUnitsProvider(memberId));
    return unitsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(),
      ),
      error: (e, _) => Text('Gagal memuat unit: ${errorMessage(e)}',
          style: const TextStyle(color: AppColors.slate500)),
      data: (units) {
        if (units.isEmpty) {
          return const _Hint('Member ini belum punya unit AC terdaftar.');
        }
        return Column(
          children: [
            for (final AcUnit u in units)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: CheckboxListTile(
                  value: selected.contains(u.id),
                  onChanged: (v) => onToggle(u.id, v ?? false),
                  title: Text('${u.brand} ${u.model}',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text([
                    if (u.roomLocation.isNotEmpty) u.roomLocation,
                    if (u.barcodeValue.isNotEmpty)
                      u.barcodeValue
                    else
                      'tanpa barcode',
                    u.status.label,
                  ].join(' · ')),
                  controlAffinity: ListTileControlAffinity.leading,
                  dense: true,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.slate100,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Text(text, style: const TextStyle(color: AppColors.slate500)),
    );
  }
}

String _formatDate(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year}';
}
