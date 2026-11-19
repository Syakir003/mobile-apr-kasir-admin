import 'dart:typed_data';

import '../../core/utils/currency.dart';
import '../../data/models/invoice.dart';

// Struk ESC/POS untuk printer thermal 58mm (32 kolom, font A). Cerminan Nest/epos-frontend-web/src/lib/escpos.ts dan
// cetak thermal di invoice-print-client.tsx: ubah keduanya bersamaan. Teks saja (tanpa logo), tanpa cutter.

const _cols = 32;
const _esc = 0x1b;
const _gs = 0x1d;

class ReceiptEscPos {
  const ReceiptEscPos({
    required this.header,
    required this.meta,
    required this.items,
    required this.extras,
    required this.total,
    required this.pembayaran,
    required this.lunas,
    required this.footer,
    this.alamat,
    this.notes,
  });

  final List<String> header;
  final List<(String, String)> meta;
  final String? alamat;
  final List<({String name, String qty, String total})> items;
  final List<(String, String)> extras;
  final String total;
  final List<(String, String)> pembayaran;
  final bool lunas;
  final String? notes;
  final List<String> footer;

  /// Isi struk dari [invoice]; sama dengan pemetaan web. [address] = alamat pelanggan (bila diketahui).
  factory ReceiptEscPos.fromInvoice(Invoice invoice, {String? address}) {
    final tambahan = invoice.grandTotal -
        (invoice.subtotal - invoice.discount + invoice.taxAmount + invoice.transportFee);
    final paid = invoice.totalPaid;
    final sisa = invoice.grandTotal - paid;
    String two(int n) => n.toString().padLeft(2, '0');
    final d = invoice.createdAt;
    return ReceiptEscPos(
      header: const [
        'Penjualan - Service - Spare Part - Rental AC',
        'JL. GUNUNG ANYAR RT. 01 RW. 06',
        'KEL. GUNUNG GEDANGAN - MOJOKERTO',
        'Telp. 0857 332 7112 - 0822 3388 9990',
        '0321 - 325831',
      ],
      meta: [
        ('No', invoice.number),
        if (d != null) ('Tanggal', '${two(d.day)}-${two(d.month)}-${d.year} ${two(d.hour)}:${two(d.minute)}'),
        if (invoice.customerName.isNotEmpty) ('Pelanggan', invoice.customerName),
        if (invoice.customerPhone.isNotEmpty) ('Telp', invoice.customerPhone),
      ],
      alamat: (address ?? '').trim().isEmpty ? null : address!.trim(),
      items: [
        for (final it in invoice.items)
          (
            name: '${it.name}${it.kind == 'product' && it.lineTotal == 0 ? ' (termasuk paket)' : ''}',
            qty: '${_trimZero(it.qty)}${it.unit.isEmpty ? '' : ' ${it.unit}'} x ${formatRupiah(it.unitPrice)}',
            total: formatRupiah(it.lineTotal),
          ),
      ],
      extras: [
        if (invoice.discount > 0) ('Diskon', '- ${formatRupiah(invoice.discount)}'),
        if (invoice.taxAmount > 0) ('Pajak (${_trimZero(invoice.taxPercent)}%)', formatRupiah(invoice.taxAmount)),
        if (invoice.transportFee > 0) ('Biaya transport', formatRupiah(invoice.transportFee)),
        if (tambahan != 0) ('Tambahan sparepart', formatRupiah(tambahan)),
      ],
      total: formatRupiah(invoice.grandTotal),
      lunas: invoice.status == InvoiceStatus.lunas,
      pembayaran: paid > 0
          ? [
              (invoice.status == InvoiceStatus.dp ? 'DP' : 'Dibayar', formatRupiah(paid)),
              ('SISA TAGIHAN', formatRupiah(sisa < 0 ? 0 : sisa)),
            ]
          : const [],
      notes: (invoice.notes ?? '').trim().isEmpty ? null : invoice.notes!.trim(),
      footer: const [
        '* Barang yang sudah dibeli tidak dapat ditukar atau dikembalikan.',
        '* Transfer ke Rek. ANDRIAS WARDOYO BCA 0501826391',
        '* Jangan memberi tip kepada petugas kami.',
        '* Suara Konsumen 082233889990.',
        'TERIMA KASIH',
      ],
    );
  }
}

String _trimZero(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';

// Printer thermal hanya paham ASCII: aksen dibuang hurufnya dipertahankan, simbol umum diganti, sisanya dihapus.
const _accents = {
  'a': 'àáâãäå',
  'e': 'èéêë',
  'i': 'ìíîï',
  'o': 'òóôõö',
  'u': 'ùúûü',
  'c': 'ç',
  'n': 'ñ',
};

String ascii(String s) {
  final out = StringBuffer();
  for (final r in s.runes) {
    final c = String.fromCharCode(r);
    if (r >= 0x20 && r <= 0x7e) {
      out.write(c);
      continue;
    }
    if ('•–—'.contains(c)) {
      out.write('-');
      continue;
    }
    final lower = c.toLowerCase();
    for (final e in _accents.entries) {
      if (e.value.contains(lower)) {
        out.write(c == lower ? e.key : e.key.toUpperCase());
        break;
      }
    }
  }
  return out.toString();
}

List<String> wrap(String text, [int width = _cols]) {
  final out = <String>[];
  var line = '';
  for (final word in ascii(text).split(RegExp(r'\s+')).where((w) => w.isNotEmpty)) {
    if (word.length > width) {
      if (line.isNotEmpty) out.add(line);
      for (var i = 0; i < word.length; i += width) {
        out.add(word.substring(i, i + width > word.length ? word.length : i + width));
      }
      line = '';
    } else if (line.isEmpty) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ' $word';
    } else {
      out.add(line);
      line = word;
    }
  }
  if (line.isNotEmpty) out.add(line);
  return out;
}

/// Kiri-kanan dalam satu baris; bila tidak muat, kiri membungkus lalu kanan rata kanan di baris baru.
List<String> pair(String left, String right) {
  final l = ascii(left);
  final r = ascii(right);
  if (l.length + 1 + r.length <= _cols) return ['$l${' ' * (_cols - l.length - r.length)}$r'];
  final tail = r.length > _cols ? r.substring(r.length - _cols) : r;
  return [...wrap(l), '${' ' * (_cols - tail.length)}$tail'];
}

Uint8List buildReceiptBytes(ReceiptEscPos d) {
  final bytes = <int>[_esc, 0x40]; // init
  void text(String s) => bytes
    ..addAll(s.codeUnits)
    ..add(0x0a);
  void align(int n) => bytes.addAll([_esc, 0x61, n]);
  void dash() => text('-' * _cols);
  void left(Iterable<String> lines) {
    align(0);
    lines.forEach(text);
  }

  align(1);
  bytes.addAll([_gs, 0x21, 0x11]); // judul 2x lebar & tinggi
  text('AYUB AC');
  bytes.addAll([_gs, 0x21, 0x00]);
  d.header.expand((h) => wrap(h)).forEach(text);
  dash();
  left(d.meta.expand((m) => pair(m.$1, m.$2)));
  if (d.alamat != null) left(wrap('Alamat: ${d.alamat}'));
  dash();
  final itemLines = d.items.expand((it) => [...wrap(it.name), ...wrap(it.qty), ...pair('', it.total), '']).toList();
  if (itemLines.isNotEmpty) itemLines.removeLast();
  left(itemLines);
  if (d.extras.isNotEmpty) {
    dash();
    left(d.extras.expand((e) => pair(e.$1, e.$2)));
  }
  dash();
  left(pair('TOTAL', d.total));
  if (d.lunas) {
    align(1);
    text('*** LUNAS ***');
  } else {
    left(d.pembayaran.expand((p) => pair(p.$1, p.$2)));
  }
  dash();
  if (d.notes != null) left(wrap('Catatan: ${d.notes}'));
  align(1);
  d.footer.expand((f) => wrap(f)).forEach(text);
  bytes.addAll([0x0a, 0x0a, 0x0a, 0x0a]); // dorong kertas keluar
  return Uint8List.fromList(bytes);
}
