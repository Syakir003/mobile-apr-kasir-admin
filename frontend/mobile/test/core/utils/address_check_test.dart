import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/utils/address_check.dart';

void main() {
  test('kabupaten/kota wajib; contoh resmi lolos', () {
    expect(checkAddress(addressExample).blocking, isNull);
    expect(checkAddress('Jl. Airlangga No. 55, Mojosari').blocking, contains('kabupaten atau kotanya'));
    expect(checkAddress('Gebang, Malang').blocking, isNull); // nama daerah dikenal di akhir alamat ber-koma
    expect(checkAddress('Gebang Malang').blocking, isNotNull); // tanpa koma tidak dianggap
  });

  test('kode pos, provinsi, dan kurung diabaikan', () {
    expect(checkAddress('Jl. Mawar 5, Mojosari, Kab. Mojokerto, Jawa Timur 61382').blocking, isNull);
    expect(checkAddress('Jl. Mawar 5 (depan masjid), Kota Surabaya').blocking, isNull);
  });

  test('hanya kabupaten/kota tanpa nama jalan/desa ditolak', () {
    expect(checkAddress('No. 5 RT 01, Kabupaten Mojokerto').blocking, contains('nama jalan'));
  });

  test('link Maps mengalahkan aturan; kosong boleh', () {
    expect(checkAddress('apa saja', hasMapsLink: true).blocking, isNull);
    expect(checkAddress('').blocking, isNull);
    expect(isMapsLink('https://maps.app.goo.gl/abc'), isTrue);
    expect(isMapsLink('Mojokerto'), isFalse);
  });

  test('fixAddress memperluas Kab./Kodya', () {
    expect(fixAddress('Jl. A, Kab.Mojokerto'), 'Jl. A, Kabupaten Mojokerto');
    expect(fixAddress('Jl. A,  Kodya Malang'), 'Jl. A, Kota Malang');
  });

  test('addressBlocking: alamat lama yang tidak diubah tidak diperiksa', () {
    expect(addressBlocking('Gebang', original: 'Gebang'), isNull);
    expect(addressBlocking('Gebang', original: 'Lain'), isNotNull);
    expect(addressBlocking('', original: 'Lain'), isNull);
  });
}
