// Alur teknisi ujung ke ujung lewat kode mobile asli vs backend Nest sungguhan:
// temuan -> foto sebelum -> kirim temuan -> mulai (scan) -> pengajuan material -> foto sesudah ->
// admin tetapkan harga jasa -> ajukan selesai -> dikembalikan admin. Tanpa docker/psql: semua lewat API.
//
// Butuh DB KOSONG-AMAN (bukan produksi, tes menulis data) berisi: akun admin & teknisi
// (password123), satu job 'assigned' milik teknisi pada unit ber-barcode, dan satu
// sparepart aktif (stok 10, harga jual 50000). Lalu:
//   flutter test test_nest/teknisi_flow_nest_test.dart --concurrency=1 \
//     --dart-define=NEST_API_URL=http://localhost:3100 \
//     --dart-define=ADMIN_EMAIL=.. --dart-define=TEKNISI_EMAIL=.. \
//     --dart-define=JOB_ID=.. --dart-define=UNIT_BARCODE=.. --dart-define=SPAREPART_ID=..
import 'dart:io';
import 'dart:typed_data';

import 'package:epos_ac/core/api/api_client.dart';
import 'package:epos_ac/data/models/job_photo.dart' show PhotoKind;
import 'package:epos_ac/data/models/technician_job.dart';
import 'package:epos_ac/data/repositories/job_repository.dart';
import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '_support.dart';

const _jobId = String.fromEnvironment('JOB_ID');
const _barcode = String.fromEnvironment('UNIT_BARCODE');
const _sparepartId = String.fromEnvironment('SPAREPART_ID');

// PNG 1x1 valid.
const _png = <int>[
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, //
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, //
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, //
  0x00, 0x05, 0xFE, 0x02, 0xFE, 0xA7, 0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, //
  0x44, 0xAE, 0x42, 0x60, 0x82,
];

Future<void> Function() _expectApiError(String fragment, Future<void> Function() body) => () async {
      try {
        await body();
      } on NestApiException catch (e) {
        expect(e.toString().toLowerCase(), contains(fragment.toLowerCase()));
        return;
      }
      fail('Seharusnya ditolak backend dengan pesan berisi "$fragment"');
    };

void main() {
  const api = ApiClient();
  final repo = NestJobRepository(api);

  Future<void> patch(String path, [Object? body]) async => api.patch(path, body: body);
  Future<TechnicianJob> job() async => (await repo.fetchJobById(_jobId))!;

  test('1. job muncul di daftar teknisi dengan status Ditugaskan', () async {
    await loginAs('teknisi');
    final jobs = await repo.fetchJobs(technicianId: 'ignored-by-mine-endpoint');
    final mine = jobs.firstWhere((j) => j.id == _jobId);
    expect(mine.status, JobStatus.assigned);
    expect(mine.unitBarcode, _barcode);
  });

  test('2. mulai ditolak sebelum ada foto sebelum', _expectApiError('foto sebelum', () async {
    await patch('/technician-jobs/$_jobId/start', {'scannedBarcode': _barcode});
  }));

  test('3. tambah temuan + saran kategori + foto sebelum', () async {
    await addFinding(_jobId, categoryName: 'Freon kurang', note: 'bocor kecil');
    final findings = await repo.fetchFindings(_jobId);
    expect(findings.single.title, 'Freon kurang');
    expect(findings.single.hasBefore, isFalse);

    expect(await repo.searchCategories('freon'), contains('Freon kurang'));

    final path = await repo.uploadFindingPhoto(
      jobId: _jobId,
      findingId: findings.single.id,
      kind: PhotoKind.sebelum,
      bytes: Uint8List.fromList(_png),
      ext: 'png',
      contentType: 'image/png',
    );
    expect(path, startsWith('/uploads/job-photos/'));
    final after = await repo.fetchFindings(_jobId);
    expect(after.single.hasBefore, isTrue);

    // Foto bisa dilihat lewat URL bertanda tangan (dipakai Image.network di UI).
    final url = await repo.signedPhotoUrl(path);
    final res = await (await HttpClient().getUrl(Uri.parse(url))).close();
    expect(res.statusCode, 200);
  });

  test('3b. kirim temuan -> findingsSentAt terisi; order belum punya invoice (priced=false)', () async {
    expect((await job()).priced, isFalse);
    expect((await job()).findingsSentAt, isNull);
    await sendFindings(_jobId);
    expect((await job()).findingsSentAt, isNotNull);
  });

  test('4. mulai: barcode salah ditolak, barcode benar -> Sedang Dikerjakan', () async {
    await expectLater(
      callUpdateJobStatus({'jobId': _jobId, 'action': 'start', 'scannedBarcode': 'SALAH'}, patch: (p, {body}) => api.patch(p, body: body)),
      throwsA(isA<NestApiException>()),
    );
    await callUpdateJobStatus({'jobId': _jobId, 'action': 'start', 'scannedBarcode': _barcode},
        patch: (p, {body}) => api.patch(p, body: body));
    expect((await job()).status, JobStatus.sedangDikerjakan);
  });

  test('5. ajukan selesai ditolak selama temuan belum berfoto sesudah', _expectApiError('sesudah', () async {
    await callUpdateJobStatus({'jobId': _jobId, 'action': 'submit_review'}, patch: (p, {body}) => api.patch(p, body: body));
  }));

  test('6. pengajuan material: picker Nest -> admin setujui -> teknisi tandai dipakai', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final spareparts = await container.read(requestableSparepartsProvider.future);
    final fr = spareparts.firstWhere((s) => s.id == _sparepartId);
    expect(fr.price, 50000);
    expect(fr.available, 10);

    await callSubmitMaterialRequest({
      'jobId': _jobId,
      'items': [
        {'kind': 'sparepart', 'refId': _sparepartId, 'qty': 2},
      ],
      'note': 'tambah freon',
    }, post: (p, {body}) => api.post(p, body: body));
    var reqs = await repo.fetchRequests(_jobId);
    expect(reqs.single.items.single.qty, 2);

    // Selagi pending, ajukan selesai harus ditolak.
    await expectLater(
      callUpdateJobStatus({'jobId': _jobId, 'action': 'submit_review'}, patch: (p, {body}) => api.patch(p, body: body)),
      throwsA(isA<NestApiException>()),
    );

    await loginAs('admin');
    await callDecideMaterialRequest({'requestId': reqs.single.id, 'decision': 'approve'},
        patch: (p, {body}) => api.patch(p, body: body));
    await loginAs('teknisi');
    await callMarkMaterialUsed({'requestId': reqs.single.id}, patch: (p, {body}) => api.patch(p));
    reqs = await repo.fetchRequests(_jobId);
    expect(reqs.single.usedAt, isNotNull);
  });

  test('7. foto sesudah; ajukan selesai ditolak sampai harga jasa ditetapkan', () async {
    final f = (await repo.fetchFindings(_jobId)).single;
    await repo.uploadFindingPhoto(
      jobId: _jobId,
      findingId: f.id,
      kind: PhotoKind.sesudah,
      bytes: Uint8List.fromList(_png),
      ext: 'png',
      contentType: 'image/png',
    );
    await _expectApiError('harga jasa', () async {
      await callUpdateJobStatus({'jobId': _jobId, 'action': 'submit_review'}, patch: (p, {body}) => api.patch(p, body: body));
    })();

    // Kasir/admin menetapkan harga jasa -> order punya invoice.
    await loginAs('admin');
    await api.put('/technician-jobs/$_jobId/service-pricing', body: {
      'lines': [
        {'name': 'Cuci AC E2E', 'qty': 1, 'unitPrice': 75000},
      ],
    });
    await loginAs('teknisi');
    expect((await job()).priced, isTrue);
    final info = jobPaymentInfoFromJobDetail(
        Map<String, dynamic>.from(await api.get('/technician-jobs/$_jobId') as Map));
    expect(info.hasInvoice, isTrue);
  });

  test('7b. ajukan selesai -> Menunggu Review', () async {
    await callUpdateJobStatus({'jobId': _jobId, 'action': 'submit_review', 'notes': 'selesai, freon ditambah'},
        patch: (p, {body}) => api.patch(p, body: body));
    final j = await job();
    expect(j.status, JobStatus.menungguReview);
    expect(j.status.isActive, isTrue);
    expect(j.notes, 'selesai, freon ditambah');
  });

  test('8. admin kembalikan -> teknisi lihat catatan review', () async {
    await loginAs('admin');
    await callUpdateJobStatus({'jobId': _jobId, 'action': 'send_back', 'note': 'foto sesudah kurang jelas'},
        patch: (p, {body}) => api.patch(p, body: body));
    await loginAs('teknisi');
    final j = await job();
    expect(j.status, JobStatus.sedangDikerjakan);
    expect(j.reviewNote, 'foto sesudah kurang jelas');
  });
}
