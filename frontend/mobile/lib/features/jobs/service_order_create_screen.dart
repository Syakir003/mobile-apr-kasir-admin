import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../data/models/ac_unit.dart';
import '../../data/models/member.dart';
import '../members/member_providers.dart';
import '../pos/pos_providers.dart' show techniciansProvider;
import 'job_providers.dart';

/// Jenis order manual yang bisa dijadwalkan (pemasangan lahir dari checkout).
enum _OrderType {
  service('service', 'Service / Perbaikan'),
  maintenance('maintenance', 'Maintenance'),
  cuci('cuci', 'Cuci AC');

  const _OrderType(this.value, this.label);
  final String value;
  final String label;
}

/// Form buat order service/maintenance/cuci manual (admin/kasir): pilih member,
/// satu/lebih unit AC miliknya, jenis pekerjaan, jadwal & keluhan opsional, lalu
/// pra-tugaskan teknisi bila ada. Menulis lewat RPC `create_service_order`.
class ServiceOrderCreateScreen extends ConsumerStatefulWidget {
  const ServiceOrderCreateScreen({super.key});

  @override
  ConsumerState<ServiceOrderCreateScreen> createState() =>
      _ServiceOrderCreateScreenState();
}

class _ServiceOrderCreateScreenState
    extends ConsumerState<ServiceOrderCreateScreen> {
  String? _memberId;
  final _unitIds = <String>{};
  _OrderType _type = _OrderType.service;
  String? _technicianId;
  DateTime? _scheduled;
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
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

  Future<void> _submit() async {
    if (_memberId == null || _unitIds.isEmpty) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    try {
      await ref.read(createServiceOrderCallerProvider)({
        'memberId': _memberId,
        'type': _type.value,
        'unitIds': _unitIds.toList(),
        if (_technicianId != null) 'technicianId': _technicianId,
        if (_scheduled != null)
          'scheduledDate': _scheduled!.toUtc().toIso8601String(),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      ref.invalidate(ordersProvider);
      ref.invalidate(jobsForCurrentUserProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('Order service dibuat.')),
      );
      router.pop();
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text('$e'.replaceFirst('Exception: ', '')),
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
      appBar: AppBar(title: const Text('Order Service Baru')),
      body: membersAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Gagal memuat member: $e',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.slate500)),
          ),
        ),
        data: (members) {
          final active = members.where((m) => m.active).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              _label('Member'),
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
              ),
              const SizedBox(height: 16),
              _label('Jenis Pekerjaan'),
              DropdownButtonFormField<_OrderType>(
                key: const Key('order-type'),
                initialValue: _type,
                decoration: const InputDecoration(),
                items: [
                  for (final t in _OrderType.values)
                    DropdownMenuItem(value: t, child: Text(t.label)),
                ],
                onChanged: _busy ? null : (v) => setState(() => _type = v!),
              ),
              const SizedBox(height: 16),
              _label('Unit AC'),
              if (_memberId == null)
                const _Hint('Pilih member dulu untuk melihat unit AC-nya.')
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
              const SizedBox(height: 16),
              _label('Jadwal (opsional)'),
              OutlinedButton.icon(
                onPressed: _busy ? null : _pickDate,
                icon: const Icon(Icons.event_outlined),
                label: Text(_scheduled == null
                    ? 'Pilih tanggal'
                    : _formatDate(_scheduled!)),
              ),
              const SizedBox(height: 16),
              _label('Teknisi (opsional)'),
              _TechnicianDropdown(
                value: _technicianId,
                enabled: !_busy,
                onChanged: (v) => setState(() => _technicianId = v),
              ),
              const SizedBox(height: 16),
              _label('Keluhan / Catatan (opsional)'),
              TextField(
                controller: _note,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: 'Mis. AC tidak dingin, bunyi berisik…',
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: FilledButton.icon(
                  onPressed: (_busy || _memberId == null || _unitIds.isEmpty)
                      ? null
                      : _submit,
                  icon: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.check),
                  label: Text(_unitIds.isEmpty
                      ? 'Buat Order'
                      : 'Buat Order (${_unitIds.length} unit)'),
                ),
              ),
            ],
          );
        },
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
      error: (e, _) => Text('Gagal memuat unit: $e',
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

class _TechnicianDropdown extends ConsumerWidget {
  const _TechnicianDropdown({
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String? value;
  final bool enabled;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final techsAsync = ref.watch(techniciansProvider);
    return techsAsync.when(
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => Text('Gagal memuat teknisi: $e',
          style: const TextStyle(color: AppColors.slate500)),
      data: (list) => DropdownButtonFormField<String?>(
        key: const Key('order-technician'),
        initialValue: list.any((t) => t.uid == value) ? value : null,
        decoration: const InputDecoration(hintText: 'Belum ditentukan'),
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text('Belum ditentukan'),
          ),
          for (final t in list)
            DropdownMenuItem<String?>(value: t.uid, child: Text(t.name)),
        ],
        onChanged: enabled ? onChanged : null,
      ),
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
