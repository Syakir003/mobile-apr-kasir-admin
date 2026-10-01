import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api_client.dart';
import '../../data/models/app_user.dart';
import '../auth/session_store.dart';

/// Satu event dari server Socket.IO. [name] 'connect' dipancarkan tiap
/// (re)connect — pembaca pakai itu untuk refetch data yang mungkin terlewat.
class RealtimeEvent {
  const RealtimeEvent(this.name, [this.data]);
  final String name;
  final Object? data;
}

/// Klien Socket.IO ke backend Nest (pengganti Supabase Realtime). Backend
/// hanya memancarkan event bisnis (`notification.new`, `job.status_changed`,
/// ...), BUKAN perubahan tabel — jadi event ini dipakai sebagai pemicu/patch,
/// data awal tetap dari REST.
///
/// Koneksi mengikuti [SessionStore]: login -> connect dengan JWT di
/// `handshake.auth.token`, logout -> putus. Admin otomatis join room
/// 'admin-dashboard' (backend menolak role lain).
class RealtimeService {
  RealtimeService({SessionStore? session, String? baseUrl})
      : _session = session ?? SessionStore.instance,
        _baseUrl = baseUrl ?? const ApiClient().baseUrl;

  final SessionStore _session;
  final String _baseUrl;
  final _events = StreamController<RealtimeEvent>.broadcast();
  StreamSubscription<Object?>? _sub;
  io.Socket? _socket;

  Stream<RealtimeEvent> get events => _events.stream;

  void start() {
    _sync();
    _sub = _session.changes.listen((_) => _sync());
  }

  void _sync() {
    _socket?.dispose();
    _socket = null;
    final token = _session.token;
    final user = _session.user;
    if (token == null || user == null) return;

    final socket = io.io(
      _baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableReconnection()
          .build(),
    );
    socket.onConnect((_) {
      if (user.role == UserRole.admin) socket.emit('join-admin-dashboard');
      _events.add(const RealtimeEvent('connect'));
    });
    socket.onAny((event, data) => _events.add(RealtimeEvent(event, data)));
    _socket = socket;
  }

  void dispose() {
    _sub?.cancel();
    _socket?.dispose();
    _events.close();
  }
}

/// Satu instance untuk seluruh app; mulai begitu pertama kali dibaca.
final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  final service = RealtimeService()..start();
  ref.onDispose(service.dispose);
  return service;
});
