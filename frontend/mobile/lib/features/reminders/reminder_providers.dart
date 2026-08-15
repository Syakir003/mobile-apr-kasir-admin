import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/wa_message.dart';
import '../members/member_providers.dart';

/// Antrean pesan WhatsApp yang belum dikirim (`wa_outbox`, status `pending`).
///
/// Realtime, seperti [notificationsStreamProvider]: baris hasil panen scheduler
/// harian muncul sendiri tanpa admin perlu me-refresh. RLS sudah membatasi ke
/// admin/kasir (migrasi 0023), jadi teknisi menerima daftar kosong.
final waOutboxStreamProvider =
    StreamProvider.autoDispose<List<WaMessage>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('wa_outbox')
      .stream(primaryKey: ['id'])
      .eq('status', 'pending')
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows) WaMessage.fromMap(r['id'] as String, Map.from(r)),
        ];
        // Realtime `.order` naik; tampilkan terbaru dulu.
        list.sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
});

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

/// Membuka tautan `wa.me` di aplikasi WhatsApp. Dipisah sebagai provider supaya
/// widget test bisa menggantinya — `url_launcher` butuh channel platform yang
/// tidak tersedia di test.
final waLauncherProvider = Provider<Future<bool> Function(Uri)>((ref) {
  return (uri) => launchUrl(uri, mode: LaunchMode.externalApplication);
});

/// Jumlah pesan menunggu dikirim (untuk badge di menu).
final waPendingCountProvider = Provider.autoDispose<int>((ref) {
  return (ref.watch(waOutboxStreamProvider).value ?? const []).length;
});

/// RPC `mark_wa_sent` — dipanggil SETELAH WhatsApp benar-benar terbuka.
final markWaSentCallerProvider =
    Provider<Future<void> Function(String id)>((ref) {
  return (id) async {
    await ref.read(supabaseProvider).rpc(
      'mark_wa_sent',
      params: {
        'payload': {'id': id},
      },
    );
  };
});

/// RPC `cancel_wa_message`.
final cancelWaMessageCallerProvider =
    Provider<Future<void> Function(String id, {String? reason})>((ref) {
  return (id, {reason}) async {
    await ref.read(supabaseProvider).rpc(
      'cancel_wa_message',
      params: {
        'payload': {'id': id, if (reason != null) 'reason': reason},
      },
    );
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
        intervalDays: (data['interval_days'] as num?)?.toInt() ?? 0,
        active: (data['active'] as bool?) ?? false,
      );
}

/// Pengaturan default siklus servis per jenis job.
final reminderSettingsProvider =
    FutureProvider.autoDispose<List<ReminderSetting>>((ref) async {
  final rows = await ref
      .read(supabaseProvider)
      .from('reminder_settings')
      .select()
      .order('job_type');
  return [for (final r in rows) ReminderSetting.fromMap(Map.from(r))];
});

/// RPC `save_reminder_settings` (admin). [intervalDays] dalam HARI.
final saveReminderSettingsCallerProvider = Provider<
    Future<void> Function(String jobType, int intervalDays, bool active)>((ref) {
  return (jobType, intervalDays, active) async {
    await ref.read(supabaseProvider).rpc(
      'save_reminder_settings',
      params: {
        'payload': {
          'jobType': jobType,
          'intervalDays': intervalDays,
          'active': active,
        },
      },
    );
  };
});

/// RPC `set_unit_service_interval` (admin). [intervalDays] null = hapus override.
final setUnitServiceIntervalCallerProvider =
    Provider<Future<void> Function(String unitId, int? intervalDays)>((ref) {
  return (unitId, intervalDays) async {
    await ref.read(supabaseProvider).rpc(
      'set_unit_service_interval',
      params: {
        'payload': {
          'unitId': unitId,
          if (intervalDays != null) 'intervalDays': intervalDays,
        },
      },
    );
  };
});
