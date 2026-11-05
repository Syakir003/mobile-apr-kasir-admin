import 'package:epos_ac/features/update/app_update.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ota_update/ota_update.dart';
import 'dart:async';

AppUpdateInfo _info({int build = 5, int min = 0, String url = 'https://api.ayubpodorukun.com/downloads/a.apk'}) =>
    AppUpdateInfo(versionName: '1.0.4', buildNumber: build, minBuildNumber: min, downloadUrl: url, notes: 'Tambah unit AC');

void main() {
  group('updateKindFor', () {
    test('build terpasang sama atau lebih baru -> tidak ada update', () {
      expect(updateKindFor(5, _info(build: 5)), UpdateKind.none);
      expect(updateKindFor(6, _info(build: 5)), UpdateKind.none);
    });

    test('lebih lama tapi masih di atas minimum -> opsional', () {
      expect(updateKindFor(4, _info(build: 5, min: 3)), UpdateKind.optional);
      expect(updateKindFor(4, _info(build: 5)), UpdateKind.optional);
    });

    test('di bawah minimum -> wajib', () {
      expect(updateKindFor(2, _info(build: 5, min: 3)), UpdateKind.required);
    });
  });

  group('isTrustedDownloadUrl', () {
    const api = 'https://api.ayubpodorukun.com';
    test('HTTPS dan host sama -> tepercaya', () {
      expect(isTrustedDownloadUrl('https://api.ayubpodorukun.com/downloads/a.apk', api), isTrue);
    });

    test('host lain, http, atau skema aneh -> ditolak', () {
      expect(isTrustedDownloadUrl('https://evil.example.com/a.apk', api), isFalse);
      expect(isTrustedDownloadUrl('http://api.ayubpodorukun.com/a.apk', api), isFalse);
      expect(isTrustedDownloadUrl('javascript:alert(1)', api), isFalse);
      expect(isTrustedDownloadUrl('https://api.ayubpodorukun.com.evil.com/a.apk', api), isFalse);
      expect(isTrustedDownloadUrl('', api), isFalse);
    });
  });

  group('AppUpdateInfo.fromJson', () {
    test('respons lengkap dibaca', () {
      final i = AppUpdateInfo.fromJson({
        'versionName': '1.0.1',
        'buildNumber': 2,
        'minBuildNumber': 1,
        'downloadUrl': 'https://x.com/a.apk',
        'notes': 'n',
      });
      expect(i?.buildNumber, 2);
      expect(i?.minBuildNumber, 1);
      expect(i?.versionName, '1.0.1');
    });

    test('tanpa angka build / URL, atau bukan objek -> null', () {
      expect(AppUpdateInfo.fromJson({'downloadUrl': 'https://x.com/a.apk'}), isNull);
      expect(AppUpdateInfo.fromJson({'buildNumber': 2}), isNull);
      expect(AppUpdateInfo.fromJson('x'), isNull);
    });
  });

  group('AppUpdateGate', () {
    Future<void> pump(WidgetTester tester, AppUpdate? update, {StreamController<OtaEvent>? ota, List<String>? urls}) =>
        tester.pumpWidget(ProviderScope(
          overrides: [
            appUpdateProvider.overrideWith((ref) async => update),
            apkInstallerProvider.overrideWithValue((url, name) {
              urls?.add(url);
              return (ota ?? StreamController<OtaEvent>()).stream;
            }),
          ],
          child: const MaterialApp(home: AppUpdateGate(child: Scaffold(body: Text('isi app')))),
        ));

    testWidgets('tanpa update: hanya isi app', (tester) async {
      await pump(tester, null);
      await tester.pump();
      expect(find.text('isi app'), findsOneWidget);
      expect(find.byKey(const Key('update-download')), findsNothing);
    });

    testWidgets('opsional: kartu tampil dan bisa ditutup dengan Nanti', (tester) async {
      await pump(tester, (info: _info(build: 5), kind: UpdateKind.optional));
      await tester.pump();
      expect(find.text('Ada versi baru'), findsOneWidget);
      expect(find.text('isi app'), findsOneWidget);

      await tester.tap(find.byKey(const Key('update-later')));
      await tester.pump();
      expect(find.text('Ada versi baru'), findsNothing);
      expect(find.text('isi app'), findsOneWidget);
    });

    testWidgets('wajib: tidak ada tombol Nanti, layar penuh menutup app', (tester) async {
      await pump(tester, (info: _info(build: 5, min: 5), kind: UpdateKind.required));
      await tester.pump();
      expect(find.text('Pembaruan wajib'), findsOneWidget);
      expect(find.byKey(const Key('update-later')), findsNothing);
      expect(find.byKey(const Key('update-download')), findsOneWidget);
    });

    testWidgets('Update: unduh di dalam app dengan progres, lalu minta ketuk Instal', (tester) async {
      final ota = StreamController<OtaEvent>();
      final urls = <String>[];
      await pump(tester, (info: _info(build: 5), kind: UpdateKind.optional), ota: ota, urls: urls);
      await tester.pump();

      await tester.tap(find.byKey(const Key('update-download')));
      await tester.pump();
      expect(urls, ['https://api.ayubpodorukun.com/downloads/a.apk']);

      ota.add(OtaEvent(OtaStatus.DOWNLOADING, '45'));
      await tester.pump();
      expect(find.text('Mengunduh… 45%'), findsOneWidget);
      // Selama mengunduh, tombol tidak bisa diketuk ulang dan kartu tidak bisa ditutup.
      expect(tester.widget<TextButton>(find.byKey(const Key('update-later'))).onPressed, isNull);

      ota.add(OtaEvent(OtaStatus.INSTALLING, null));
      await tester.pump();
      expect(find.textContaining('Mengunduh'), findsNothing);
      expect(find.textContaining('Ketuk "Instal"'), findsOneWidget);
      await ota.close();
    });

    testWidgets('izin pasang belum diberikan: pesan arahan, bukan error mentah', (tester) async {
      final ota = StreamController<OtaEvent>();
      await pump(tester, (info: _info(build: 5, min: 5), kind: UpdateKind.required), ota: ota);
      await tester.pump();
      await tester.tap(find.byKey(const Key('update-download')));
      await tester.pump();

      ota.add(OtaEvent(OtaStatus.PERMISSION_NOT_GRANTED_ERROR, null));
      await tester.pump();
      expect(find.textContaining('Instal aplikasi tidak dikenal'), findsOneWidget);
      await ota.close();
    });
  });
}
