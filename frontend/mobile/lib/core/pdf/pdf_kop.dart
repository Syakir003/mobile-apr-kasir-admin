import 'package:pdf/widgets.dart' as pw;

/// Kop surat dokumen cetak (logo + identitas toko + garis tebal), dipakai semua laporan A4.
pw.Widget pdfKop(pw.MemoryImage logo) => pw.Column(children: [
      pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.center, children: [
        pw.Image(logo, height: 44),
        pw.Expanded(
          child: pw.Column(children: [
            pw.Text('AYUB AC', style: const pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold)),
            pw.Text('Penjualan • Service • Spare Part • Rental AC', style: const pw.TextStyle(fontSize: 8)),
            pw.Text('JL. GUNUNG ANYAR RT. 01 RW. 06, KEL. GUNUNG GEDANGAN - MOJOKERTO',
                style: const pw.TextStyle(fontSize: 8)),
            pw.Text('Telp. 0857 332 7112 - 0822 3388 9990 - 0321 - 325831', style: const pw.TextStyle(fontSize: 8)),
          ]),
        ),
        pw.SizedBox(width: 44),
      ]),
      pw.Divider(thickness: 1.5),
    ]);
