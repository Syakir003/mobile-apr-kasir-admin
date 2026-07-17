import 'package:epos_ac/data/models/job_photo.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('PhotoKind', () {
    test('fromValue memetakan nilai; tak dikenal -> sebelum', () {
      expect(PhotoKind.fromValue('sebelum'), PhotoKind.sebelum);
      expect(PhotoKind.fromValue('sesudah'), PhotoKind.sesudah);
      expect(PhotoKind.fromValue('ngawur'), PhotoKind.sebelum);
      expect(PhotoKind.fromValue(null), PhotoKind.sebelum);
    });
  });

  group('buildJobPhotoPath', () {
    test('menyusun <jobId>/<kind>/<ms>.<ext>', () {
      expect(
        buildJobPhotoPath('job1', PhotoKind.sebelum, 1700000000000, 'jpg'),
        'job1/sebelum/1700000000000.jpg',
      );
      expect(
        buildJobPhotoPath('job1', PhotoKind.sesudah, 42, 'PNG'),
        'job1/sesudah/42.png',
      );
    });

    test('membersihkan ext non-alfanumerik & fallback jpg bila kosong', () {
      expect(
        buildJobPhotoPath('j', PhotoKind.sebelum, 1, '.jpeg'),
        'j/sebelum/1.jpeg',
      );
      expect(
        buildJobPhotoPath('j', PhotoKind.sebelum, 1, ''),
        'j/sebelum/1.jpg',
      );
    });
  });

  group('JobPhoto.fromMap', () {
    test('membaca baris job_photos', () {
      final p = JobPhoto.fromMap('p1', {
        'job_id': 'j1',
        'kind': 'sesudah',
        'path': 'j1/sesudah/1.jpg',
        'created_at': '2026-07-17T03:00:00Z',
      });
      expect(p.id, 'p1');
      expect(p.jobId, 'j1');
      expect(p.kind, PhotoKind.sesudah);
      expect(p.path, 'j1/sesudah/1.jpg');
      expect(p.createdAt, isNotNull);
    });

    test('field kosong bila baris minimal', () {
      final p = JobPhoto.fromMap('p2', {'kind': 'sebelum'});
      expect(p.jobId, '');
      expect(p.path, '');
      expect(p.kind, PhotoKind.sebelum);
      expect(p.createdAt, isNull);
    });
  });
}
