import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_client.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/num_parse.dart';
import '../../core/widgets/app_filter_chip.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';

// Monitoring Jadwal servis (padanan tab Monitoring di /reminder-wa web): daftar pelanggan dengan ringkasan status
// jatuh tempo set AC-nya, lalu halaman AC per pelanggan (kirim pengingat, atur siklus, Buat Job Servis).
// Status dihitung server (reminders/service-schedule.util.ts); klien hanya menampilkan.

const scheduleStatusOrder = [
  'terlambat',
  'segera',
  'bulan_ini',
  'aman',
  'belum_terjadwal',
  'siklus_kosong',
  'mati',
  'menunggu_data',
];

const scheduleStatusLabel = {
  'terlambat': 'Terlambat',
  'segera': 'Segera (≤7 hari)',
  'bulan_ini': '8–30 hari',
  'aman': 'Aman',
  'belum_terjadwal': 'Belum terjadwal',
  'siklus_kosong': 'Siklus belum diisi',
  'mati': 'Pengingat mati',
  'menunggu_data': 'Menunggu data teknisi',
};

const _statusShort = {
  'terlambat': 'Terlambat',
  'segera': 'Segera',
  'bulan_ini': '8–30 hari',
  'aman': 'Aman',
  'belum_terjadwal': 'Belum terjadwal',
  'siklus_kosong': 'Siklus kosong',
  'mati': 'Mati',
  'menunggu_data': 'Menunggu data',
};

/// Kartu ringkasan yang dipakai sebagai filter (urutan sama dengan web).
const scheduleFilterCards = ['terlambat', 'segera', 'bulan_ini', 'siklus_kosong', 'mati', 'menunggu_data'];

Color scheduleStatusColor(String s) => switch (s) {
      'terlambat' => AppColors.danger,
      'segera' => AppColors.warning,
      'aman' => AppColors.success,
      _ => AppColors.slate600,
    };

/// Tanggal kalender WIB (UTC+7) dari sebuah instan.
DateTime _wibDay(DateTime t) {
  final w = t.toUtc().add(const Duration(hours: 7));
  return DateTime.utc(w.year, w.month, w.day);
}

/// Selisih hari kalender (WIB) dari [now]: negatif = sudah lewat.
int daysUntil(String iso, {DateTime? now}) {
  final target = _wibDay(DateTime.parse(iso));
  return target.difference(_wibDay(now ?? DateTime.now())).inDays;
}

/// "Terlambat 20 hari" / "3 hari lagi" / "Jatuh tempo hari ini"; status lain memakai label bawaan.
String scheduleLabel(String status, String? nextServiceDate, {DateTime? now}) {
  final timed = const ['terlambat', 'segera', 'bulan_ini', 'aman'].contains(status);
  if (!timed || nextServiceDate == null) return scheduleStatusLabel[status] ?? status;
  final n = daysUntil(nextServiceDate, now: now);
  return n < 0 ? 'Terlambat ${-n} hari' : (n == 0 ? 'Jatuh tempo hari ini' : '$n hari lagi');
}

String _dmy(String? iso) {
  if (iso == null) return '-';
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '-';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year}';
}

class LastWa {
  LastWa(Map<String, dynamic> j)
      : status = '${j['status']}',
        error = j['error'] as String?,
        at = '${j['at']}';
  final String status;
  final String? error;
  final String at;
  String get label => const {'pending': 'Menunggu', 'terkirim': 'Terkirim', 'gagal': 'Gagal', 'dibatalkan': 'Dibatalkan'}[status] ?? status;
}

/// Ringkasan satu pelanggan (GET /reminders/schedule/members).
class MemberSchedule {
  MemberSchedule(Map<String, dynamic> j)
      : memberId = '${j['memberId']}',
        name = '${j['name']}',
        phone = j['phone'] as String?,
        waOptOut = j['waOptOut'] == true,
        unitCount = numFromNest(j['unitCount'])?.toInt() ?? 0,
        counts = _counts(j['counts']),
        nextDate = (j['nextService'] as Map?)?['date'] as String?,
        nextStatus = (j['nextService'] as Map?)?['status'] as String?,
        jobBerjalan = numFromNest(j['jobBerjalanCount'])?.toInt() ?? 0,
        lastWa = j['lastWa'] == null ? null : LastWa(Map<String, dynamic>.from(j['lastWa'] as Map));
  final String memberId;
  final String name;
  final String? phone;
  final bool waOptOut;
  final int unitCount;
  final Map<String, int> counts;
  final String? nextDate;
  final String? nextStatus;
  final int jobBerjalan;
  final LastWa? lastWa;
}

Map<String, int> _counts(Object? v) =>
    {for (final s in scheduleStatusOrder) s: numFromNest((v as Map?)?[s])?.toInt() ?? 0};

class MemberScheduleList {
  MemberScheduleList(Map<String, dynamic> j)
      : counts = _counts(j['counts']),
        items = [for (final e in (j['items'] as List? ?? const [])) MemberSchedule(Map<String, dynamic>.from(e as Map))],
        total = numFromNest(j['total'])?.toInt() ?? 0;
  final Map<String, int> counts;
  final List<MemberSchedule> items;
  final int total;
}

/// Satu set AC (GET /reminders/schedule).
class ScheduleUnit {
  ScheduleUnit(Map<String, dynamic> j)
      : id = '${j['id']}',
        label = (j['label'] as String?) ?? 'AC',
        room = j['roomLocation'] as String?,
        memberName = ((j['member'] as Map?)?['name'] as String?) ?? '',
        lastServiceDate = j['lastServiceDate'] as String?,
        interval = numFromNest(j['serviceIntervalDays'])?.toInt(),
        nextServiceDate = j['nextServiceDate'] as String?,
        reminderEnabled = j['reminderEnabled'] == true,
        unitStatus = j['unitStatus'] as String?,
        status = '${j['status']}',
        jobBerjalan = j['adaJobBerjalan'] == true,
        lastWa = j['lastWa'] == null ? null : LastWa(Map<String, dynamic>.from(j['lastWa'] as Map));
  final String id;
  final String label;
  final String? room;
  final String memberName;
  final String? lastServiceDate;
  final int? interval;
  final String? nextServiceDate;
  final bool reminderEnabled;
  final String? unitStatus;
  final String status;
  final bool jobBerjalan;
  final LastWa? lastWa;
}

/// Unit yang tercentang otomatis: aktif, pengingat menyala, tanpa job berjalan, dan jatuh tempo (≤ hari ini + 3 hari WIB).
Set<String> dueUnitIds(List<ScheduleUnit> units, {DateTime? now}) {
  final limit = _wibDay((now ?? DateTime.now()).add(const Duration(days: 3)));
  return {
    for (final u in units)
      if (!u.jobBerjalan &&
          u.unitStatus == 'aktif' &&
          u.reminderEnabled &&
          u.nextServiceDate != null &&
          !_wibDay(DateTime.parse(u.nextServiceDate!)).isAfter(limit))
        u.id,
  };
}

typedef MemberScheduleQuery = ({String status, String q, int pageSize});

final memberScheduleProvider = FutureProvider.autoDispose.family<MemberScheduleList, MemberScheduleQuery>((ref, k) async {
  final params = <String, String>{
    'page': '1',
    'pageSize': '${k.pageSize}',
    if (k.status != 'semua') 'status': k.status,
    if (k.q.isNotEmpty) 'q': k.q,
  };
  final r = await const ApiClient().get('/reminders/schedule/members?${Uri(queryParameters: params).query}');
  return MemberScheduleList(Map<String, dynamic>.from(r as Map));
});

final memberUnitsScheduleProvider = FutureProvider.autoDispose.family<List<ScheduleUnit>, String>((ref, memberId) async {
  final r = await const ApiClient().get('/reminders/schedule?memberId=${Uri.encodeQueryComponent(memberId)}&pageSize=100') as Map;
  return [for (final e in (r['items'] as List? ?? const [])) ScheduleUnit(Map<String, dynamic>.from(e as Map))];
});

/// `POST /reminders/units/:id/send-now` (admin). Hasil: pesan sukses, atau alasan belum terkirim.
final sendReminderNowProvider = Provider<Future<String> Function(String unitId)>((ref) {
  return (unitId) async {
    final r = await const ApiClient().post('/reminders/units/$unitId/send-now', body: <String, dynamic>{}) as Map;
    return r['status'] == 'terkirim'
        ? 'Pengingat terkirim.'
        : 'Pesan dicatat tapi belum terkirim: ${r['error'] ?? 'alasan tidak diketahui'}';
  };
});

/// `PATCH /ac-units/:id` — nyalakan/matikan pengingat dan atur siklus servis (hari, 7–730).
final updateUnitReminderProvider =
    Provider<Future<void> Function(String unitId, {bool? enabled, int? days})>((ref) {
  return (unitId, {enabled, days}) async {
    await const ApiClient().patch('/ac-units/$unitId', body: {
      if (enabled != null) 'reminderEnabled': enabled,
      if (days != null) 'serviceIntervalDays': days,
    });
  };
});

String? intervalError(String text) {
  final n = int.tryParse(text.trim());
  if (n == null) return 'Siklus harus bilangan bulat (hari)';
  if (n < 7) return 'Siklus servis minimal 7 hari';
  if (n > 730) return 'Siklus servis maksimal 730 hari';
  return null;
}

// ---------------- Daftar pelanggan ----------------
class ReminderScheduleScreen extends ConsumerStatefulWidget {
  const ReminderScheduleScreen({super.key});

  @override
  ConsumerState<ReminderScheduleScreen> createState() => _ReminderScheduleScreenState();
}

class _ReminderScheduleScreenState extends ConsumerState<ReminderScheduleScreen> {
  String _status = 'semua';
  String _q = '';
  int _pageSize = 20;

  MemberScheduleQuery get _key => (status: _status, q: _q, pageSize: _pageSize);

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(memberScheduleProvider(_key));
    final counts = async.asData?.value.counts;
    return Scaffold(
      appBar: AppBar(title: const Text('Monitoring Jadwal Servis')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              key: const Key('schedule-search'),
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Cari nama / nomor HP...', isDense: true),
              onSubmitted: (v) => setState(() {
                _q = v.trim();
                _pageSize = 20;
              }),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
            child: Row(children: [
              AppFilterChip(label: 'Semua', selected: _status == 'semua', onTap: () => setState(() => _status = 'semua')),
              for (final s in scheduleFilterCards) ...[
                const SizedBox(width: 8),
                AppFilterChip(
                  key: Key('schedule-chip-$s'),
                  label: '${_statusShort[s]}${counts == null ? '' : ' ${counts[s]}'}',
                  selected: _status == s,
                  onTap: () => setState(() {
                    _status = _status == s ? 'semua' : s;
                    _pageSize = 20;
                  }),
                ),
              ],
            ]),
          ),
          Expanded(
            child: async.when(
              loading: () => const AppSkeletonList(),
              error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat jadwal', onRetry: () => ref.invalidate(memberScheduleProvider(_key))),
              data: (d) => d.items.isEmpty
                  ? const AppEmptyState(icon: Icons.event_available_outlined, title: 'Tidak ada pelanggan', message: 'Ubah filter atau kata kunci.')
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      children: [
                        for (final m in d.items) _tile(m),
                        if (d.items.length < d.total && _pageSize < 100)
                          TextButton(
                            key: const Key('schedule-more'),
                            onPressed: () => setState(() => _pageSize = (_pageSize + 20).clamp(20, 100)),
                            child: Text('Muat lebih banyak (${d.items.length}/${d.total})'),
                          ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(MemberSchedule m) {
    final chips = [
      for (final s in scheduleStatusOrder)
        if ((m.counts[s] ?? 0) > 0) StatusBadge(label: '${_statusShort[s]} · ${m.counts[s]}', color: scheduleStatusColor(s)),
    ];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        key: Key('schedule-member-${m.memberId}'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        onTap: () => context.push('/pengingat/jadwal/${m.memberId}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(m.name, style: const TextStyle(fontWeight: FontWeight.w600))),
              Text('${m.unitCount} AC', style: const TextStyle(color: AppColors.slate600, fontSize: 12)),
            ]),
            if ((m.phone ?? '').isNotEmpty || m.waOptOut)
              Text([if ((m.phone ?? '').isNotEmpty) m.phone!, if (m.waOptOut) 'berhenti pengingat WA'].join(' · '),
                  style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 4, children: chips),
            const SizedBox(height: 6),
            Text(
              [
                if (m.nextStatus != null) 'Jadwal terdekat: ${scheduleLabel(m.nextStatus!, m.nextDate)}',
                if (m.jobBerjalan > 0) '${m.jobBerjalan} AC sedang dikerjakan',
                'WA terakhir: ${m.lastWa == null ? 'belum ada' : '${m.lastWa!.label} ${_dmy(m.lastWa!.at)}'}',
              ].join(' · '),
              style: const TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
          ]),
        ),
      ),
    );
  }
}

// ---------------- AC milik satu pelanggan ----------------
class MemberScheduleScreen extends ConsumerStatefulWidget {
  const MemberScheduleScreen({super.key, required this.memberId});
  final String memberId;

  @override
  ConsumerState<MemberScheduleScreen> createState() => _MemberScheduleScreenState();
}

class _MemberScheduleScreenState extends ConsumerState<MemberScheduleScreen> {
  // null = belum diubah admin, jadi yang tercentang = unit jatuh tempo.
  Set<String>? _picked;

  void _refresh() => ref.invalidate(memberUnitsScheduleProvider(widget.memberId));

  Future<void> _sendNow(ScheduleUnit u) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kirim pengingat sekarang?'),
        content: Text('Pesan pengingat servis untuk ${u.label}${u.room == null ? '' : ' (${u.room})'} akan dikirim ke ${u.memberName} lewat WhatsApp.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Batal')),
          FilledButton(key: const Key('send-now-confirm'), onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Kirim')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      messenger.showSnackBar(SnackBar(content: Text(await ref.read(sendReminderNowProvider)(u.id))));
      _refresh();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
    }
  }

  Future<void> _edit(ScheduleUnit u) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _EditReminderSheet(unit: u),
    );
    if (saved == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(memberUnitsScheduleProvider(widget.memberId));
    final role = ref.watch(currentUserProvider).value?.role;
    final admin = role == UserRole.admin;
    return Scaffold(
      appBar: AppBar(title: Text(async.asData?.value.firstOrNull?.memberName ?? 'AC Pelanggan')),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat AC', onRetry: _refresh),
        data: (units) {
          if (units.isEmpty) {
            return const AppEmptyState(icon: Icons.ac_unit, title: 'Belum ada AC terdaftar');
          }
          final selectable = {for (final u in units) if (!u.jobBerjalan) u.id};
          final selected = (_picked ?? dueUnitIds(units)).intersection(selectable);
          return Column(children: [
            Expanded(
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 16), children: [
                for (final u in units) _unitCard(u, selected, admin),
              ]),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: FilledButton.icon(
                    key: const Key('schedule-create-job'),
                    onPressed: () => context.push('/orders/new', extra: {'memberId': widget.memberId, 'unitIds': selected.toList()}),
                    icon: const Icon(Icons.add_task),
                    label: Text(selected.isEmpty ? 'Buat Job Servis' : 'Buat Job Servis (${selected.length} unit)'),
                  ),
                ),
              ),
            ),
          ]);
        },
      ),
    );
  }

  Widget _unitCard(ScheduleUnit u, Set<String> selected, bool admin) {
    final color = scheduleStatusColor(u.status);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Checkbox(
              key: Key('schedule-pick-${u.id}'),
              value: selected.contains(u.id),
              onChanged: u.jobBerjalan
                  ? null
                  : (v) => setState(() {
                        final next = {...selected};
                        v == true ? next.add(u.id) : next.remove(u.id);
                        _picked = next;
                      }),
            ),
            Expanded(
              child: Text('${u.label}${u.room == null || u.room!.isEmpty ? '' : ' (${u.room})'}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
            StatusBadge(label: scheduleLabel(u.status, u.nextServiceDate), color: color),
          ]),
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: Text(
              [
                'Servis terakhir ${_dmy(u.lastServiceDate)}',
                if (u.interval != null) 'siklus ${u.interval} hari',
                'jadwal berikut ${_dmy(u.nextServiceDate)}',
                if (u.jobBerjalan) 'sedang ada job',
                if (u.unitStatus != null && u.unitStatus != 'aktif') 'status ${u.unitStatus}',
                'WA: ${u.lastWa == null ? 'belum ada' : u.lastWa!.label}',
              ].join(' · '),
              style: const TextStyle(fontSize: 12, color: AppColors.slate600),
            ),
          ),
          if (u.lastWa?.status == 'gagal' && (u.lastWa!.error ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 12, top: 2),
              child: Text(u.lastWa!.error!, style: const TextStyle(fontSize: 12, color: AppColors.danger)),
            ),
          if (admin)
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton(key: Key('schedule-edit-${u.id}'), onPressed: () => _edit(u), child: const Text('Atur pengingat')),
              TextButton(key: Key('schedule-send-${u.id}'), onPressed: () => _sendNow(u), child: const Text('Kirim sekarang')),
            ]),
        ]),
      ),
    );
  }
}

class _EditReminderSheet extends ConsumerStatefulWidget {
  const _EditReminderSheet({required this.unit});
  final ScheduleUnit unit;

  @override
  ConsumerState<_EditReminderSheet> createState() => _EditReminderSheetState();
}

class _EditReminderSheetState extends ConsumerState<_EditReminderSheet> {
  late bool _enabled = widget.unit.reminderEnabled;
  late final _days = TextEditingController(text: widget.unit.interval?.toString() ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _days.dispose();
    super.dispose();
  }

  bool get _toggled => _enabled != widget.unit.reminderEnabled;
  bool get _daysChanged => _days.text.trim() != (widget.unit.interval?.toString() ?? '');
  // Siklus wajib diisi saat pengingat DINYALAKAN dari mati atau bila diisi; unit lama yang masih kosong boleh kosong.
  bool get _needsDays => _enabled && (!widget.unit.reminderEnabled || _days.text.trim().isNotEmpty);
  String? get _error => _needsDays ? intervalError(_days.text) : null;
  bool get _valid => (_toggled || _daysChanged) && _error == null && !_busy;

  Future<void> _save() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    try {
      await ref.read(updateUnitReminderProvider)(
        widget.unit.id,
        enabled: _toggled ? _enabled : null,
        days: _enabled && _days.text.trim().isNotEmpty && _daysChanged ? int.parse(_days.text.trim()) : null,
      );
      messenger.showSnackBar(const SnackBar(content: Text('Pengingat AC diperbarui.')));
      nav.pop(true);
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(errorMessage(e)), backgroundColor: AppColors.danger));
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Atur pengingat servis', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        Text('${widget.unit.memberName} - ${widget.unit.label}. Satu set AC = satu pengingat.',
            style: const TextStyle(fontSize: 12, color: AppColors.slate600)),
        SwitchListTile(
          key: const Key('reminder-enabled'),
          contentPadding: EdgeInsets.zero,
          title: const Text('Pengingat menyala'),
          value: _enabled,
          onChanged: _busy ? null : (v) => setState(() => _enabled = v),
        ),
        if (_enabled)
          TextField(
            key: const Key('reminder-days'),
            controller: _days,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: 'Siklus servis (hari, 7–730)', errorText: _days.text.isEmpty && !_needsDays ? null : _error),
          ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          height: 50,
          child: FilledButton(key: const Key('reminder-save'), onPressed: _valid ? _save : null, child: Text(_busy ? 'Menyimpan...' : 'Simpan')),
        ),
      ]),
    );
  }
}
