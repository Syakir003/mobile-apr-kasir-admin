import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/utils/terbilang.dart';

void main() {
  test('nol', () {
    expect(terbilangRupiah(0), 'Nol rupiah');
  });

  test('satuan', () {
    expect(terbilangRupiah(1), 'Satu rupiah');
    expect(terbilangRupiah(11), 'Sebelas rupiah');
  });

  test('belasan & puluhan', () {
    expect(terbilangRupiah(12), 'Dua belas rupiah');
    expect(terbilangRupiah(20), 'Dua puluh rupiah');
    expect(terbilangRupiah(21), 'Dua puluh satu rupiah');
  });

  test('ratusan pakai awalan se-', () {
    expect(terbilangRupiah(100), 'Seratus rupiah');
    expect(terbilangRupiah(150), 'Seratus lima puluh rupiah');
  });

  test('ribuan pakai awalan se-', () {
    expect(terbilangRupiah(1000), 'Seribu rupiah');
    expect(terbilangRupiah(2000), 'Dua ribu rupiah');
  });

  test('jutaan & campuran penuh', () {
    expect(
      terbilangRupiah(7004150),
      'Tujuh juta empat ribu seratus lima puluh rupiah',
    );
  });

  test('miliar', () {
    expect(terbilangRupiah(1000000000), 'Satu miliar rupiah');
  });
}
