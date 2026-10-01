import 'package:epos_ac/data/models/app_notification.dart';
import 'package:epos_ac/features/notifications/notifications_providers.dart';
import 'package:flutter_test/flutter_test.dart';

AppNotification _n(String id, {bool read = false}) =>
    AppNotification(id: id, title: 't$id', body: '', type: 'info', read: read);

void main() {
  test('mergeNotification: yang baru di depan', () {
    final r = mergeNotification([_n('1')], _n('2'));
    expect(r.map((n) => n.id), ['2', '1']);
  });

  test('mergeNotification: id sama diganti, tidak digandakan', () {
    final r = mergeNotification([_n('2'), _n('1')], _n('1', read: true));
    expect(r.map((n) => n.id), ['1', '2']);
    expect(r.first.read, isTrue);
  });

  test('fromMap membaca createdAt camelCase dari Nest', () {
    final n = AppNotification.fromMap('1', {'title': 'x', 'createdAt': '2026-09-30T10:00:00.000Z'});
    expect(n.createdAt, isNotNull);
  });
}
