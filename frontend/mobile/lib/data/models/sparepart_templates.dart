// Template cepat sparepart AC. Salinan dari web
// (Nest/epos-frontend-web/src/lib/sparepart-mode.ts); kalau diubah, ubah keduanya.
// Hanya isian awal, semuanya tetap bisa diedit di form.

typedef SparepartTemplate = ({
  String name,
  String category,
  String mode,
  String unit,
  String packUnit,
  String packSize,
});

SparepartTemplate _pack(String name, String category, String mode, String unit, String packUnit, String size) =>
    (name: name, category: category, mode: mode, unit: unit, packUnit: packUnit, packSize: size);

SparepartTemplate _one(String name, String category, [String unit = 'pcs']) =>
    _pack(name, category, 'biasa', unit, '', '');

SparepartTemplate _freon(String type, String kg) =>
    _pack('Freon $type', 'Freon & Gas', 'gabungan', 'kg', 'tabung', kg);

SparepartTemplate _pipa(String size) =>
    _pack('Pipa tembaga $size', 'Pipa & Insulasi', 'gabungan', 'm', 'roll', '15');

SparepartTemplate _kabel(String name, String m) => _pack(name, 'Kabel', 'gabungan', 'm', 'rol', m);

SparepartTemplate _dus(String name, String pcs, [String category = 'Baut & Pengikat']) =>
    _pack(name, category, 'konversi', 'pcs', 'dus', pcs);

final Map<String, List<SparepartTemplate>> kSparepartTemplates = {
  'Freon & Gas (tabung → kg)': [
    _freon('R32', '10'),
    _freon('R410A', '11.3'),
    _freon('R22', '13.6'),
    _freon('R134a', '13.6'),
  ],
  'Pipa & Insulasi (roll → meter)': [
    _pipa('1/4"'),
    _pipa('3/8"'),
    _pipa('1/2"'),
    _pipa('5/8"'),
    _pipa('3/4"'),
    _pack('Insulasi pipa (armaflex)', 'Pipa & Insulasi', 'konversi', 'm', 'batang', '2'),
    _pack('Selang drain', 'Pipa & Insulasi', 'konversi', 'm', 'roll', '50'),
    _pack('Pipa PVC drain 3/4"', 'Pipa & Insulasi', 'konversi', 'm', 'batang', '4'),
  ],
  'Kabel (rol → meter)': [
    _kabel('Kabel NYM 3x1,5', '50'),
    _kabel('Kabel NYM 3x2,5', '50'),
    _kabel('Kabel NYYHY 4x1,5 (kontrol indoor-outdoor)', '50'),
    _kabel('Kabel NYAF (fleksibel)', '100'),
  ],
  'Bahan Habis Pakai': [
    _pack('Oli kompresor (POE)', 'Bahan Habis Pakai', 'konversi', 'liter', 'jerigen', '5'),
    _pack('Cairan cuci AC (coil cleaner)', 'Bahan Habis Pakai', 'konversi', 'liter', 'jerigen', '5'),
    _one('Foam cleaner (kaleng)', 'Bahan Habis Pakai', 'kaleng'),
    _one('Isolasi pipa (wrapping tape)', 'Bahan Habis Pakai', 'roll'),
    _one('Lakban / duct tape', 'Bahan Habis Pakai', 'roll'),
    _one('Kawat las perak (brazing)', 'Bahan Habis Pakai', 'batang'),
    _one('Flux / pasta las', 'Bahan Habis Pakai', 'kaleng'),
  ],
  'Baut & Pengikat (dus → pcs)': [
    _dus('Baut & skrup', '100'),
    _dus('Dynabolt / fischer', '100'),
    _dus('Klem pipa', '100'),
    _dus('Cable ties', '100'),
    _dus('Flare nut', '50', 'Fitting & Valve'),
  ],
  'Komponen Listrik': [
    for (final name in const [
      'Kapasitor AC',
      'Fan motor outdoor',
      'Fan motor indoor (blower)',
      'PCB / modul indoor',
      'PCB / modul outdoor',
      'Sensor suhu (thermistor)',
      'Remote AC',
      'Kontaktor',
      'Relay',
      'Overload protector kompresor',
      'Pompa drain mini',
      'Motor swing',
    ])
      _one(name, 'Komponen Listrik'),
  ],
  'Komponen Mekanik & Dudukan': [
    _one('Kompresor', 'Komponen Mekanik', 'unit'),
    _one('Filter dryer', 'Komponen Mekanik'),
    _one('Pipa kapiler', 'Komponen Mekanik'),
    _one('Service valve', 'Fitting & Valve'),
    _one('Baling-baling / fan blade', 'Komponen Mekanik'),
    _one('Filter udara indoor', 'Komponen Mekanik'),
    _one('Bracket outdoor', 'Dudukan', 'pasang'),
    _one('Plat / mounting indoor', 'Dudukan'),
    _one('Karet peredam (rubber pad)', 'Dudukan', 'set'),
  ],
};
