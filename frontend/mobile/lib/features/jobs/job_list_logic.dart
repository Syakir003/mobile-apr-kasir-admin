import '../../data/models/job_distance.dart';
import '../../data/models/technician_job.dart';

/// Logika murni daftar job (cerminan helper di web `teknisi/queue/queue-client.tsx`): filter hari, pencarian,
/// jarak per baris, dan urutan "Terdekat dari Toko". Dipisah dari layar supaya bisa diuji tanpa widget.

/// Lokasi kerja job: titik lokasi kerja bila diisi, kalau tidak alamat utama member.
String jobLocation(TechnicianJob j) => j.workAddress.trim().isNotEmpty ? j.workAddress.trim() : j.memberAddress.trim();

/// Teks yang dicari di kotak pencarian: nama pelanggan, HP, unit, ruangan, barcode, lokasi, catatan, jenis, dan
/// teknisi (hanya bila [includeTechnician]).
String rowSearchText(List<TechnicianJob> row, {required bool includeTechnician}) => row
    .expand((j) => [
          j.memberName,
          j.memberPhone,
          j.unitTitle.isEmpty ? 'Order ${j.type}' : j.unitTitle,
          j.unitRoom,
          j.unitBarcode,
          jobLocation(j),
          j.notes ?? '',
          j.typeLabel,
          if (includeTechnician) ...j.technicianNames,
        ])
    .where((s) => s.trim().isNotEmpty)
    .join(' ')
    .toLowerCase();

// ---- Filter hari (kunci 'YYYY-MM-DD' pada zona waktu perangkat; aritmetika kalender murni lewat UTC) ----

String dayKey(DateTime d) {
  final l = d.toLocal();
  return '${l.year.toString().padLeft(4, '0')}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')}';
}

DateTime _keyToUtc(String key) {
  final p = key.split('-').map(int.parse).toList();
  return DateTime.utc(p[0], p[1], p[2]);
}

String addDaysKey(String key, int days) {
  final d = _keyToUtc(key).add(Duration(days: days));
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// Pekan berjalan Senin-Minggu yang memuat tanggal itu.
(String, String) weekRange(String key) {
  final start = addDaysKey(key, -(_keyToUtc(key).weekday - 1));
  return (start, addDaysKey(start, 6));
}

/// Filter hari: 'all' | 'today' | 'tomorrow' | 'week' | tanggal tertentu (YYYY-MM-DD). Yang disaring: jadwal job.
bool matchesDay(TechnicianJob job, String filter, String todayKey) {
  if (filter == 'all') return true;
  final s = job.scheduledDate;
  if (s == null) return false;
  final key = dayKey(s);
  switch (filter) {
    case 'today':
      return key == todayKey;
    case 'tomorrow':
      return key == addDaysKey(todayKey, 1);
    case 'week':
      final (start, end) = weekRange(todayKey);
      return key.compareTo(start) >= 0 && key.compareTo(end) <= 0;
    default:
      return key == filter;
  }
}

/// Filter hari -> rentang tanggal untuk halaman cetak ('' = tanpa batas).
(String, String) dayFilterRange(String filter, String todayKey) => switch (filter) {
      'all' => ('', ''),
      'today' => (todayKey, todayKey),
      'tomorrow' => (addDaysKey(todayKey, 1), addDaysKey(todayKey, 1)),
      'week' => weekRange(todayKey),
      _ => (filter, filter),
    };

// ---- Jarak per baris & urutan "Terdekat" ----

/// Jarak satu baris (servis banyak AC = beberapa job): yang terdekat di antara job yang jaraknya diketahui.
class RowDistance {
  const RowDistance.ok(double this.km, this.precision)
      : state = DistanceState.ok,
        reason = null;
  const RowDistance.pending()
      : state = DistanceState.pending,
        km = null,
        precision = null,
        reason = null;
  const RowDistance.unknown(DistanceReason this.reason)
      : state = DistanceState.unknown,
        km = null,
        precision = null;

  final DistanceState state;
  final double? km;
  final DistancePrecision? precision;
  final DistanceReason? reason;
}

RowDistance rowDistance(List<TechnicianJob> row, Map<String, JobDistance> byJob) {
  double? best;
  DistancePrecision? bestPrecision;
  var pending = false;
  var reason = DistanceReason.noAddress;
  for (final j in row) {
    final d = byJob[j.id];
    if (d == null) continue;
    if (d.state == DistanceState.ok && d.km != null) {
      if (best == null || d.km! < best) {
        best = d.km;
        bestPrecision = d.precision;
      }
    } else if (d.state == DistanceState.pending) {
      pending = true;
    } else if (d.state == DistanceState.unknown && d.reason != null) {
      reason = d.reason!;
    }
  }
  if (best != null) return RowDistance.ok(best, bestPrecision);
  return pending ? const RowDistance.pending() : RowDistance.unknown(reason);
}

/// Urutan indeks baris "Terdekat": yang jaraknya diketahui dulu (dekat ke jauh), sisanya tetap urutan asal.
List<int> nearestOrder(List<RowDistance> ds) {
  final idx = List<int>.generate(ds.length, (i) => i);
  idx.sort((a, b) {
    final da = ds[a], db = ds[b];
    if (da.state == DistanceState.ok && db.state == DistanceState.ok) {
      final c = da.km!.compareTo(db.km!);
      return c != 0 ? c : a.compareTo(b);
    }
    final okA = da.state == DistanceState.ok, okB = db.state == DistanceState.ok;
    if (okA != okB) return okA ? -1 : 1;
    return a.compareTo(b); // List.sort tidak dijamin stabil: pertahankan urutan asal lewat indeks
  });
  return idx;
}

/// `± 3,4 km` (koma desimal Indonesia, maksimal 1 desimal).
String kmText(double km) {
  final s = km.toStringAsFixed(1);
  return '${s.endsWith('.0') ? s.substring(0, s.length - 2) : s.replaceAll('.', ',')} km';
}
