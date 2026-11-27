import 'package:flutter/material.dart';

/// Tulisan kecil di bawah isian PK.
const kPkHint = 'Boleh titik atau koma. 3/4 PK = 0,75';

/// Ukuran AC yang lazim. Di luar ini ditanyakan dulu, bukan ditolak.
// ponytail: daftar tetap; tambah angka di sini (dan di web lib/pk.ts) bila toko menjual ukuran lain.
const _usualPk = <double>[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 15, 18, 20];

/// Isian PK yang janggal. Kosong atau bukan angka dibiarkan (urusan validator form).
List<String> unusualPks(Iterable<String> inputs) => [
      for (final raw in inputs)
        if (num.tryParse(raw.trim().replaceAll(',', '.')) case final v?
            when !_usualPk.contains(v.toDouble()))
          raw.trim(),
    ];

/// true = lanjut menyimpan. Pop-up hanya muncul bila ada PK yang janggal.
Future<bool> confirmPk(BuildContext context, Iterable<String> inputs) async {
  final odd = unusualPks(inputs);
  if (odd.isEmpty) return true;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('PK ${odd.map((v) => '"$v"').join(', ')} tidak lazim'),
      content: const Text('Boleh titik atau koma. Untuk 3/4 PK ketik 0,75 atau 0.75.'),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Perbaiki')),
        FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Tetap simpan')),
      ],
    ),
  );
  return ok ?? false;
}
