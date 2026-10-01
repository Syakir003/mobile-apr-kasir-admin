import 'package:epos_ac/features/jobs/job_providers.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fungsi murni (bukan Riverpod) pengganti tiap RPC lama — pola sama seperti
/// test provider POS/invoice. Mock `patch`/`post` cukup fungsi biasa yang
/// mencatat panggilannya, tanpa HTTP sungguhan.
void main() {
  group('callUpdateJobStatus — routing action ke rute Nest yang benar', () {
    Future<({String path, Object? body})> capture(
      Map<String, dynamic> payload,
    ) async {
      String? path;
      Object? capturedBody;
      await callUpdateJobStatus(payload, patch: (p, {Object? body}) async {
        path = p;
        capturedBody = body;
        return null;
      });
      return (path: path!, body: capturedBody);
    }

    test("'start' -> PATCH .../start dengan scannedBarcode", () async {
      final r = await capture({
        'jobId': 'job-1',
        'action': 'start',
        'scannedBarcode': 'ACUNIT-1',
      });
      expect(r.path, '/technician-jobs/job-1/start');
      expect(r.body, {'scannedBarcode': 'ACUNIT-1'});
    });

    test("'start' tanpa scannedBarcode -> kirim string kosong (bukan null)", () async {
      final r = await capture({'jobId': 'job-1', 'action': 'start'});
      expect(r.body, {'scannedBarcode': ''});
    });

    test("'approve' -> PATCH .../approve-complete tanpa body", () async {
      final r = await capture({'jobId': 'job-1', 'action': 'approve'});
      expect(r.path, '/technician-jobs/job-1/approve-complete');
    });

    test("'send_back' -> PATCH .../send-back dengan note", () async {
      final r = await capture({
        'jobId': 'job-1',
        'action': 'send_back',
        'note': 'Foto kurang jelas',
      });
      expect(r.path, '/technician-jobs/job-1/send-back');
      expect(r.body, {'note': 'Foto kurang jelas'});
    });

    test("'cancel' -> PATCH .../cancel", () async {
      final r = await capture({'jobId': 'job-1', 'action': 'cancel'});
      expect(r.path, '/technician-jobs/job-1/cancel');
    });

    test("aksi tak dikenal -> ArgumentError, bukan silent no-op", () async {
      expect(
        () => callUpdateJobStatus({'jobId': 'job-1', 'action': 'lainnya'},
            patch: (_, {Object? body}) async => null),
        throwsArgumentError,
      );
    });

    test("'complete'/'submit_review' dengan notes -> PATCH notes DULU baru submit-for-review", () async {
      final calls = <({String path, Object? body})>[];
      await callUpdateJobStatus(
        {'jobId': 'job-1', 'action': 'complete', 'notes': 'Sudah dites'},
        patch: (p, {Object? body}) async {
          calls.add((path: p, body: body));
          return null;
        },
      );
      expect(calls, hasLength(2));
      expect(calls[0].path, '/technician-jobs/job-1/notes');
      expect(calls[0].body, {'notes': 'Sudah dites'});
      expect(calls[1].path, '/technician-jobs/job-1/submit-for-review');
    });

    test("'submit_review' tanpa notes -> LANGSUNG submit-for-review (gak ada PATCH notes ekstra)", () async {
      final calls = <String>[];
      await callUpdateJobStatus(
        {'jobId': 'job-1', 'action': 'submit_review'},
        patch: (p, {Object? body}) async {
          calls.add(p);
          return null;
        },
      );
      expect(calls, ['/technician-jobs/job-1/submit-for-review']);
    });
  });

  group('callAssignTechnician', () {
    test('mengirim technicianId ke rute assign', () async {
      String? path;
      Object? capturedBody;
      await callAssignTechnician(
        {'jobId': 'job-1', 'technicianId': 'tek-1'},
        patch: (p, {Object? body}) async {
          path = p;
          capturedBody = body;
          return null;
        },
      );
      expect(path, '/technician-jobs/job-1/assign');
      expect(capturedBody, {'technicianId': 'tek-1'});
    });
  });

  group('callSubmitMaterialRequest', () {
    test('mengirim items (+note opsional) ke rute materials job', () async {
      String? path;
      Object? capturedBody;
      await callSubmitMaterialRequest(
        {
          'jobId': 'job-1',
          'items': [
            {'kind': 'sparepart', 'refId': 'r1', 'qty': 2},
          ],
          'note': 'perlu segera',
        },
        post: (p, {Object? body}) async {
          path = p;
          capturedBody = body;
          return null;
        },
      );
      expect(path, '/technician-jobs/job-1/materials');
      expect(capturedBody, {
        'items': [
          {'kind': 'sparepart', 'refId': 'r1', 'qty': 2},
        ],
        'note': 'perlu segera',
      });
    });

    test('note null -> tidak dikirim sama sekali (bukan note: null)', () async {
      Object? capturedBody;
      await callSubmitMaterialRequest(
        {'jobId': 'job-1', 'items': []},
        post: (p, {Object? body}) async {
          capturedBody = body;
          return null;
        },
      );
      expect((capturedBody as Map).containsKey('note'), false);
    });
  });

  group('callDecideMaterialRequest', () {
    test("key 'note' lama dipetakan ke 'decisionNote'", () async {
      String? path;
      Object? capturedBody;
      await callDecideMaterialRequest(
        {'requestId': 'req-1', 'decision': 'approve', 'note': 'oke'},
        patch: (p, {Object? body}) async {
          path = p;
          capturedBody = body;
          return null;
        },
      );
      expect(path, '/material-requests/req-1/decide');
      expect(capturedBody, {'decision': 'approve', 'decisionNote': 'oke'});
    });

    test('items ikut dikirim kalau ada (revise)', () async {
      Object? capturedBody;
      await callDecideMaterialRequest(
        {
          'requestId': 'req-1',
          'decision': 'revise',
          'items': [
            {'kind': 'sparepart', 'refId': 'r1', 'qty': 1},
          ],
        },
        patch: (p, {Object? body}) async {
          capturedBody = body;
          return null;
        },
      );
      expect((capturedBody as Map)['items'], [
        {'kind': 'sparepart', 'refId': 'r1', 'qty': 1},
      ]);
    });
  });

  group('callMarkMaterialUsed', () {
    test('PATCH tanpa body ke rute mark-used', () async {
      String? path;
      await callMarkMaterialUsed(
        {'requestId': 'req-1'},
        patch: (p, {Object? body}) async {
          path = p;
          return null;
        },
      );
      expect(path, '/material-requests/req-1/mark-used');
    });
  });
}
