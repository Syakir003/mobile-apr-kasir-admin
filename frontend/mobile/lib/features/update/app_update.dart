import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ota_update/ota_update.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_client.dart';
import '../../core/theme/app_theme.dart';

/// Respons `GET /app-version` (publik): rilis APK terbaru yang dibagikan di luar Play Store.
class AppUpdateInfo {
  const AppUpdateInfo({
    required this.versionName,
    required this.buildNumber,
    required this.minBuildNumber,
    required this.downloadUrl,
    required this.notes,
  });

  final String versionName;

  /// Angka setelah `+` di pubspec.yaml (versionCode Android): satu-satunya yang dibandingkan.
  final int buildNumber;

  /// Build di bawah ini WAJIB update (mis. kontrak API berubah); 0 = semua update opsional.
  final int minBuildNumber;
  final String downloadUrl;
  final String notes;

  static AppUpdateInfo? fromJson(Object? json) {
    if (json is! Map) return null;
    final build = json['buildNumber'];
    final url = json['downloadUrl'];
    if (build is! int || url is! String) return null;
    return AppUpdateInfo(
      versionName: '${json['versionName'] ?? build}',
      buildNumber: build,
      minBuildNumber: json['minBuildNumber'] is int ? json['minBuildNumber'] as int : 0,
      downloadUrl: url,
      notes: '${json['notes'] ?? ''}',
    );
  }
}

enum UpdateKind { none, optional, required }

/// Keputusan murni (mudah diuji): update hanya bila server punya build yang lebih baru dari yang terpasang.
UpdateKind updateKindFor(int currentBuild, AppUpdateInfo info) {
  if (info.buildNumber <= currentBuild) return UpdateKind.none;
  return currentBuild < info.minBuildNumber ? UpdateKind.required : UpdateKind.optional;
}

/// Link unduhan hanya dibuka bila HTTPS dan satu host dengan API kita. Kalau file `version.json` di server salah isi
/// atau disusupi, app tidak akan mengarahkan teknisi ke situs lain.
bool isTrustedDownloadUrl(String url, String apiBaseUrl) {
  final u = Uri.tryParse(url);
  final api = Uri.tryParse(apiBaseUrl);
  return u != null && api != null && u.scheme == 'https' && u.host.isNotEmpty && u.host == api.host;
}

typedef AppUpdate = ({AppUpdateInfo info, UpdateKind kind});

/// Cek sekali tiap app dibuka. Gagal apa pun (offline, server belum punya info versi, link tak tepercaya) = tidak ada
/// update: pengecekan ini tidak boleh pernah menghalangi pemakaian app.
final appUpdateProvider = FutureProvider<AppUpdate?>((ref) async {
  try {
    const api = ApiClient();
    final info = AppUpdateInfo.fromJson(await api.getPublic('/app-version'));
    if (info == null || !isTrustedDownloadUrl(info.downloadUrl, api.baseUrl)) return null;
    final current = int.tryParse((await PackageInfo.fromPlatform()).buildNumber) ?? 0;
    final kind = updateKindFor(current, info);
    return kind == UpdateKind.none ? null : (info: info, kind: kind);
  } catch (_) {
    return null;
  }
});

/// Unduh APK di dalam app lalu buka dialog pasang Android (paket ota_update). Android tetap meminta satu ketukan
/// "Instal" untuk APK di luar Play Store; yang dihemat: tidak lewat browser & tidak perlu mencari file unduhan.
/// Provider supaya tes bisa menggantinya dengan aliran event palsu.
final apkInstallerProvider = Provider<Stream<OtaEvent> Function(String url, String fileName)>(
  (ref) => (url, fileName) => OtaUpdate().execute(url, destinationFilename: fileName),
);

/// Membungkus seluruh app (lewat `MaterialApp.router(builder:)`). Update opsional = kartu di bawah yang bisa ditutup;
/// wajib = layar penuh yang menutup app sampai teknisi memasang versi baru. Tanpa Navigator, jadi aman dipasang di
/// atas router.
class AppUpdateGate extends ConsumerStatefulWidget {
  const AppUpdateGate({super.key, required this.child});
  final Widget child;

  @override
  ConsumerState<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends ConsumerState<AppUpdateGate> {
  bool _dismissed = false;

  /// Persen unduhan selama berjalan; null = tidak sedang mengunduh.
  int? _progress;
  String? _message;

  /// Cara lama: buka link di browser. Dipakai bila unduhan di dalam app gagal.
  Future<void> _openInBrowser(AppUpdateInfo info) =>
      launchUrl(Uri.parse(info.downloadUrl), mode: LaunchMode.externalApplication);

  void _update(AppUpdateInfo info) {
    setState(() {
      _progress = 0;
      _message = null;
    });
    final events = ref.read(apkInstallerProvider)(info.downloadUrl, 'epos-ac-${info.buildNumber}.apk');
    events.listen(
      (e) {
        if (!mounted) return;
        switch (e.status) {
          case OtaStatus.DOWNLOADING:
            setState(() => _progress = int.tryParse(e.value ?? '') ?? _progress);
          case OtaStatus.INSTALLING:
          case OtaStatus.INSTALLATION_DONE:
            setState(() {
              _progress = null;
              _message = 'Ketuk "Instal" pada dialog Android. Kalau dialog tertutup, ketuk Update lagi.';
            });
          case OtaStatus.ALREADY_RUNNING_ERROR:
            break;
          case OtaStatus.PERMISSION_NOT_GRANTED_ERROR:
            setState(() {
              _progress = null;
              _message = 'Izinkan "Instal aplikasi tidak dikenal" untuk app ini, lalu ketuk Update lagi.';
            });
          default:
            _fallback(info);
        }
      },
      onError: (_) => _fallback(info),
    );
  }

  void _fallback(AppUpdateInfo info) {
    if (!mounted) return;
    setState(() {
      _progress = null;
      _message = 'Unduhan di dalam app gagal, dibuka lewat browser. Setelah selesai, ketuk file-nya untuk memasang.';
    });
    _openInBrowser(info);
  }

  @override
  Widget build(BuildContext context) {
    final update = ref.watch(appUpdateProvider).value;
    if (update == null) return widget.child;
    final info = update.info;
    final required = update.kind == UpdateKind.required;
    if (!required && _dismissed) return widget.child;

    final body = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(required ? 'Pembaruan wajib' : 'Ada versi baru',
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold, color: AppColors.slate900)),
        const SizedBox(height: 6),
        Text(
          required
              ? 'Versi ${info.versionName} perlu dipasang supaya app tetap cocok dengan server.'
              : 'Versi ${info.versionName} sudah tersedia.',
          style: const TextStyle(color: AppColors.slate600),
        ),
        if (info.notes.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(info.notes, style: const TextStyle(color: AppColors.slate500, fontSize: 13)),
        ],
        const SizedBox(height: 8),
        Text(
          _message ?? 'Ketuk Update, tunggu unduhan selesai, lalu ketuk "Instal". Data kamu tidak hilang.',
          key: const Key('update-message'),
          style: const TextStyle(color: AppColors.slate500, fontSize: 13),
        ),
        if (_progress != null) ...[
          const SizedBox(height: 10),
          LinearProgressIndicator(value: _progress! / 100),
          const SizedBox(height: 4),
          Text('Mengunduh… $_progress%', style: const TextStyle(color: AppColors.slate500, fontSize: 12)),
        ],
        const SizedBox(height: 14),
        Row(
          children: [
            if (!required)
              TextButton(
                key: const Key('update-later'),
                onPressed: _progress != null ? null : () => setState(() => _dismissed = true),
                child: const Text('Nanti'),
              ),
            const Spacer(),
            FilledButton.icon(
              key: const Key('update-download'),
              onPressed: _progress != null ? null : () => _update(info),
              icon: const Icon(Icons.system_update),
              label: const Text('Update'),
            ),
          ],
        ),
      ],
    );

    return Stack(
      children: [
        widget.child,
        if (required)
          Positioned.fill(
            child: Material(
              color: Colors.white,
              child: SafeArea(child: Center(child: Padding(padding: const EdgeInsets.all(24), child: body))),
            ),
          )
        else
          Positioned(
            left: 12,
            right: 12,
            bottom: 12,
            child: SafeArea(
              child: Material(
                elevation: 6,
                borderRadius: BorderRadius.circular(AppRadius.md),
                color: Colors.white,
                child: Padding(padding: const EdgeInsets.all(16), child: body),
              ),
            ),
          ),
      ],
    );
  }
}
