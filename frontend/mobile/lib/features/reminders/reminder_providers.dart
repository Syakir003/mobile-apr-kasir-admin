import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../data/models/wa_message.dart';
import '../members/member_providers.dart';
import '../../core/utils/num_parse.dart';

/// Baris `whatsapp_logs` dari Nest (`GET /whatsapp-logs`, camelCase Prisma,
/// `member` ikut di-include) -> bentuk yang dibaca [WaMessage.fromMap].
Map<String, dynamic> waLogRowFromNest(Map<String, dynamic> row) => {
      'member_id': row['memberId'],
      'member_name': (row['member'] as Map?)?['name'],
      'phone': row['phone'],
      'kind': row['kind'],
      'body': row['message'],
      'status': row['status'],
      'unit_ids': row['unitIds'],
      'due_date': row['dueDate'],
      'created_at': row['createdAt'],
      'sent_at': row['sentAt'],
      'error': row['error'],
    };

/// 100 log WA terbaru (opsional per status), terbaru dulu.
Future<List<WaMessage>> _fetchWaLogs({String? status}) async {
  final res = await const ApiClient()
      .get('/whatsapp-logs?pageSize=100${status == null ? '' : '&status=$status'}') as Map;
  return [
    for (final r in (res['items'] as List).cast<Map>())
      WaMessage.fromMap(r['id'] as String, waLogRowFromNest(Map<String, dynamic>.from(r))),
  ];
}

/// Pesan WA yang GAGAL terkirim. Pengiriman otomatis (Fonnte), jadi yang perlu
/// perhatian admin/kasir hanya yang gagal — admin bisa mengirim ulang.
final waFailedProvider = FutureProvider.autoDispose<List<WaMessage>>(
  (ref) => _fetchWaLogs(status: 'gagal'),
);

/// Nama pelanggan per `member_id`, untuk melabeli kartu antrean.
///
/// Penggabungan dilakukan di klien karena `wa_outbox` di-stream lewat Realtime,
/// dan Realtime mengirim baris tabel apa adanya — tidak bisa `select` berelasi
/// seperti PostgREST biasa. Nama diambil dari [membersStreamProvider] yang
/// memang sudah menyala di layar lain (POS, Member), jadi tidak ada permintaan
/// jaringan tambahan. RLS members untuk admin/kasir sama luasnya dengan RLS
/// `wa_outbox`, jadi tidak ada baris antrean yang namanya tak terjangkau.
final waMemberNamesProvider = Provider.autoDispose<Map<String, String>>((ref) {
  final members = ref.watch(membersStreamProvider).value ?? const [];
  return {for (final m in members) m.id: m.name};
});

/// `POST /whatsapp-logs/:id/retry` (admin) — kirim ulang pesan berstatus gagal.
final retryWaCallerProvider = Provider<Future<void> Function(String id)>((ref) {
  return (id) async {
    await const ApiClient().post('/whatsapp-logs/$id/retry');
  };
});

/// Satu baris pengaturan siklus servis (`reminder_settings`).
class ReminderSetting {
  const ReminderSetting({
    required this.jobType,
    required this.intervalDays,
    required this.active,
  });

  final String jobType;
  final int intervalDays;
  final bool active;

  /// Admin berpikir dalam bulan ("2 bulan"), database menyimpan hari (60).
  /// Pembulatan ke atas supaya 60 -> 2 dan 45 -> 2, bukan 1.
  int get intervalMonths => (intervalDays / 30).ceil();

  String get label => switch (jobType) {
        'cuci' => 'Cuci AC',
        'maintenance' => 'Maintenance',
        _ => jobType,
      };

  factory ReminderSetting.fromMap(Map<String, dynamic> data) => ReminderSetting(
        jobType: (data['job_type'] as String?) ?? '',
        intervalDays: numFromNest(data['interval_days'])?.toInt() ?? 0,
        active: (data['active'] as bool?) ?? false,
      );
}

/// Baris `reminder_settings` dari Nest (camelCase Prisma) -> bentuk yang
/// dibaca [ReminderSetting.fromMap].
Map<String, dynamic> reminderSettingRowFromNest(Map<String, dynamic> row) => {
      'job_type': row['jobType'],
      'interval_days': row['intervalDays'],
      'active': row['active'],
    };

/// Pengaturan default siklus servis per jenis job — pengganti query Supabase
/// langsung pada migrasi Flutter -> Nest (`GET /reminders/settings`, sudah
/// diurut `jobType asc` di server).
final reminderSettingsProvider =
    FutureProvider.autoDispose<List<ReminderSetting>>((ref) async {
  final rows = await const ApiClient().get('/reminders/settings') as List;
  return [
    for (final r in rows)
      ReminderSetting.fromMap(reminderSettingRowFromNest(Map<String, dynamic>.from(r as Map))),
  ];
});

/// `PUT /reminders/settings` (admin) — pengganti RPC `save_reminder_settings`.
/// [intervalDays] dalam HARI. Body bentuk satu-baris ini didukung eksplisit
/// oleh `SaveReminderSettingsDto` Nest (alternatif dari bentuk `{settings:
/// [...]}` yang dipakai web), jadi payloadnya tidak berubah dari sebelumnya.
final saveReminderSettingsCallerProvider = Provider<
    Future<void> Function(String jobType, int intervalDays, bool active)>((ref) {
  return (jobType, intervalDays, active) async {
    await const ApiClient().put('/reminders/settings', body: {
      'jobType': jobType,
      'intervalDays': intervalDays,
      'active': active,
    });
  };
});

/// `PUT /reminders/unit-interval` (admin) — pengganti RPC
/// `set_unit_service_interval`. [intervalDays] null = hapus override.
final setUnitServiceIntervalCallerProvider =
    Provider<Future<void> Function(String unitId, int? intervalDays)>((ref) {
  return (unitId, intervalDays) async {
    await const ApiClient().put(
      '/reminders/unit-interval',
      body: {
        'unitId': unitId,
        if (intervalDays != null) 'intervalDays': intervalDays,
      },
    );
  };
});

/// Satu redaksi pesan pengingat (`wa_reminder_templates`) + teks bawaannya.
///
/// [body] adalah teks yang berlaku sekarang; [defaultBody] teks pabrik untuk
/// tombol "Reset ke bawaan". Placeholder `{nama}`, `{unit}`, `{tanggal}`
/// disubstitusi `build_wa_body()` di Postgres saat pesan diantrekan.
class WaTemplate {
  const WaTemplate({
    required this.kind,
    required this.body,
    required this.defaultBody,
  });

  final WaKind kind;
  final String body;
  final String defaultBody;

  factory WaTemplate.fromMap(Map<String, dynamic> data) => WaTemplate(
        kind: WaKind.fromValue(data['kind']),
        body: (data['body'] as String?) ?? '',
        defaultBody: (data['defaultBody'] as String?) ?? '',
      );
}

/// Redaksi 3 pesan pengingat untuk layar editor — pengganti RPC
/// `list_wa_reminder_templates` langsung pada migrasi Flutter -> Nest
/// (`GET /reminders/templates`, admin/kasir). `RemindersService.listTemplates`
/// memanggil RPC Postgres yang SAMA lewat `SupabaseRpcService` (masa
/// transisi) — bentuk respons identik, parsing di bawah tidak berubah.
final waTemplatesProvider =
    FutureProvider.autoDispose<List<WaTemplate>>((ref) async {
  final rows = await const ApiClient().get('/reminders/templates') as List;
  return [
    for (final r in rows)
      WaTemplate.fromMap(Map<String, dynamic>.from(r as Map)),
  ];
});

/// `PUT /reminders/templates` (admin) — pengganti RPC
/// `save_wa_reminder_templates`. Map kind → teks; kunci yang tak dikirim
/// tidak diubah.
final saveWaTemplatesCallerProvider =
    Provider<Future<void> Function(Map<WaKind, String>)>((ref) {
  return (templates) async {
    await const ApiClient().put('/reminders/templates', body: {
      'templates': {
        for (final e in templates.entries) e.key.value: e.value,
      },
    });
  };
});

/// Riwayat semua pesan WA (terkirim, gagal, dibatalkan, menunggu) — 100 terbaru.
final waHistoryProvider = FutureProvider.autoDispose<List<WaMessage>>(
  (ref) => _fetchWaLogs(),
);
