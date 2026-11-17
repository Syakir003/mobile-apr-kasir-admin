import {
  buildGeocodePlan,
  haversineKm,
  pickVerifiedPoint,
  parseCoordsFromMapsUrl,
  searchTextFromMapsUrl,
  SHOP_LOCATION,
} from './geo.util';
import { MAPS_SEARCH_PREFIX, normalizeMapsInput } from './maps-url.util';

describe('parseCoordsFromMapsUrl', () => {
  it('membaca @lat,lng dari link tempat', () => {
    expect(
      parseCoordsFromMapsUrl(
        'https://www.google.com/maps/place/Toko/@-7.4738,112.4556,17z/data=!4m6',
      ),
    ).toEqual({
      lat: -7.4738,
      lng: 112.4556,
    });
  });

  it('pin presisi !3d!4d menang atas @ (yang @ itu titik tengah peta)', () => {
    const url =
      'https://www.google.com/maps/place/X/@-7.5,112.5,15z/data=!3d-7.4701!4d112.4402';
    expect(parseCoordsFromMapsUrl(url)).toEqual({
      lat: -7.4701,
      lng: 112.4402,
    });
  });

  it('membaca q=lat,lng dan query=lat,lng (termasuk yang di-encode)', () => {
    expect(
      parseCoordsFromMapsUrl('https://maps.google.com/?q=-7.47,112.45'),
    ).toEqual({ lat: -7.47, lng: 112.45 });
    expect(
      parseCoordsFromMapsUrl(
        'https://www.google.com/maps/search/?api=1&query=-7.47%2C112.45',
      ),
    ).toEqual({
      lat: -7.47,
      lng: 112.45,
    });
  });

  it('link pencarian teks buatan sistem TIDAK punya koordinat', () => {
    expect(
      parseCoordsFromMapsUrl(
        normalizeMapsInput('Mojosari Mojokerto') as string,
      ),
    ).toBeNull();
  });

  it('menolak angka di luar Indonesia dan input kosong', () => {
    expect(
      parseCoordsFromMapsUrl('https://www.google.com/maps/@48.85,2.35,12z'),
    ).toBeNull();
    expect(parseCoordsFromMapsUrl(null)).toBeNull();
    expect(parseCoordsFromMapsUrl('')).toBeNull();
  });
});

describe('searchTextFromMapsUrl', () => {
  it('mengembalikan teks asli dari link pencarian buatan sistem', () => {
    const url = normalizeMapsInput('Jl. Raya Mojosari No 5') as string;
    expect(searchTextFromMapsUrl(url)).toBe('Jl. Raya Mojosari No 5');
  });

  it('null untuk link lain', () => {
    expect(searchTextFromMapsUrl('https://maps.app.goo.gl/abc')).toBeNull();
    expect(searchTextFromMapsUrl(MAPS_SEARCH_PREFIX)).toBeNull();
    expect(searchTextFromMapsUrl(undefined)).toBeNull();
  });
});

describe('haversineKm', () => {
  it('titik yang sama = 0', () => {
    expect(haversineKm(SHOP_LOCATION, SHOP_LOCATION)).toBe(0);
  });

  it('Mojokerto ke Surabaya (Tugu Pahlawan) ± 40 km garis lurus', () => {
    const km = haversineKm(SHOP_LOCATION, { lat: -7.2459, lng: 112.7378 });
    expect(km).toBeGreaterThan(35);
    expect(km).toBeLessThan(45);
  });
});

const qs = (alamat: string) => buildGeocodePlan(alamat).queries.map((q) => q.q);

describe('buildGeocodePlan — komponen alamat dan cakupan yang dikecilkan', () => {
  it('format yang dianjurkan: lengkap dulu, lalu dikecilkan', () => {
    const p = buildGeocodePlan(
      'Jl. Airlangga No. 55, Mojosari, Kabupaten Mojokerto',
    );
    expect(p.region).toEqual({
      name: 'Mojokerto',
      label: 'Kabupaten Mojokerto',
    });
    expect(qs('Jl. Airlangga No. 55, Mojosari, Kabupaten Mojokerto')).toEqual([
      'Jalan Airlangga, Mojosari, Kabupaten Mojokerto',
      'Mojosari, Kabupaten Mojokerto',
      'Jalan Airlangga, Kabupaten Mojokerto',
    ]);
  });

  it('tiap pertanyaan membawa komponennya beserta jenisnya (dipakai verifikasi kunci 2)', () => {
    const q = buildGeocodePlan('Pohjejer Kec. Gondang Kab. Mojokerto')
      .queries[0];
    expect(q.q).toBe('Pohjejer, Gondang, Kabupaten Mojokerto');
    expect(q.terms).toEqual([
      { text: 'Pohjejer', kind: 'desa' },
      { text: 'Gondang', kind: 'kecamatan' },
    ]);
  });

  it('penanda Kec./Kel./Ds. dipakai menentukan jenis, dan kecamatan dicoba sendirian', () => {
    expect(qs('Pohjejer Kec. Gondang Kab. Mojokerto')).toEqual([
      'Pohjejer, Gondang, Kabupaten Mojokerto',
      'Gondang, Kabupaten Mojokerto',
      'Pohjejer, Kabupaten Mojokerto',
    ]);
  });

  it('KODE POS dan PROVINSI diabaikan di posisi mana pun (kasus PT Profilindah)', () => {
    const a =
      'Jl. Ngoro Industri Barat II Blok U No. 9-10, Kawasan Ngoro Industri Persada, Ngoro, Sukorejo, Lolawang, Kec. Ngoro, Kabupaten Mojokerto, Jawa Timur 61385';
    const hasil = qs(a);
    expect(hasil).toContain('Ngoro, Kabupaten Mojokerto');
    expect(hasil.join(' ')).not.toMatch(/61385|Jawa Timur/);
    expect(hasil[0]).toBe(
      'Jalan Ngoro Industri Barat II, Lolawang, Ngoro, Kabupaten Mojokerto',
    );
    expect(hasil.length).toBeLessThanOrEqual(6);
  });

  it('kode pos / provinsi dalam berbagai posisi tidak mengubah hasil', () => {
    const dasar = qs('Jl. Pahlawan, Ngoro, Kabupaten Mojokerto');
    expect(qs('Jl. Pahlawan, Ngoro, Kabupaten Mojokerto 61385')).toEqual(dasar);
    expect(qs('Jl. Pahlawan, Ngoro, Kabupaten Mojokerto, Jawa Timur')).toEqual(
      dasar,
    );
    expect(qs('Jl. Pahlawan, Ngoro, Kabupaten Mojokerto, Jatim 61385')).toEqual(
      dasar,
    );
    expect(
      qs('Jl. Pahlawan, Ngoro, Kabupaten Mojokerto, Jawa Timur, Indonesia'),
    ).toEqual(dasar);
    expect(qs('Gayaman, Mojokerto, Jawa Timur 61385')).toEqual([
      'Gayaman, Mojokerto',
    ]);
  });

  it('keterangan dalam kurung dan "depan/belakang/dekat ..." diabaikan (kasus Jl. Majapahit)', () => {
    expect(qs('Jl. Majapahit ( Belakang BCA ) Kota Mojokerto')).toEqual([
      'Jalan Majapahit, Kota Mojokerto',
    ]);
    expect(
      qs(
        'Jl. Pasinan No. 61, Puri, Kabupaten Mojokerto, depan Perum Lawang Asri',
      ),
    ).toEqual([
      'Jalan Pasinan, Puri, Kabupaten Mojokerto',
      'Puri, Kabupaten Mojokerto',
      'Jalan Pasinan, Kabupaten Mojokerto',
    ]);
    // kurung yang tidak ditutup tidak boleh menelan kabupaten
    expect(
      buildGeocodePlan('Jl. Majapahit (belakang BCA, Kota Mojokerto').region
        ?.label,
    ).toBe('Kota Mojokerto');
  });

  it('angka, nomor, RT/RW, dan "blok F 12" tidak ikut tersisa', () => {
    const hasil = qs(
      'Perum Green Jayanegara Residence blok F 12 Kab. Mojokerto',
    );
    expect(hasil.join(' ')).not.toMatch(/\b12\b/);
    expect(hasil).toContain('Jayanegara, Kabupaten Mojokerto');
    expect(
      qs(
        'Jl. Raya Mojosari No. 12 RT.02/RW.03, Dsn. Kemlagi, Kec. Mojosari, Kab. Mojokerto',
      )[0],
    ).toContain('Jalan Raya Mojosari');
  });

  it('nama perumahan tanpa kelurahan: katanya dicoba satu per satu (kasus Kranggan Permai)', () => {
    expect(qs('Perum Kranggan Permai Blok B-11 Kota Mojokerto')).toEqual([
      'Kranggan, Kota Mojokerto',
      'Permai, Kota Mojokerto',
    ]);
    expect(
      qs('Ngoro Industri Persada Blok J no.8 Ngoro Kab. Mojokerto')[0],
    ).toBe('Ngoro, Kabupaten Mojokerto');
  });

  it('nama ruko dilewati, jalan dan daerah dicari bersama (kasus Jl. Airlangga)', () => {
    for (const a of [
      'Jl. Airlangga No. 55 Ruko Royal RD-06, Mojosari, Kab. Mojokerto',
      'Jl. Airlangga no. 55 Ruko Royal RD-06 Mojosari Kab. Mojokerto', // alamat lama tanpa koma
    ]) {
      const hasil = qs(a);
      expect(hasil[0]).toBe('Jalan Airlangga, Mojosari, Kabupaten Mojokerto');
      expect(hasil).toContain('Mojosari, Kabupaten Mojokerto');
    }
  });

  it('desa dan kecamatan menyatu: kata terakhir dicoba sendiri', () => {
    expect(
      qs('Jl. Pemuda No. 55B, Randubango Kec. Mojosari Kab. Mojokerto'),
    ).toContain('Mojosari, Kabupaten Mojokerto');
    expect(
      qs(
        'Perumahan Mutiara Garden blok C -12 , Lengkong Mojoanyar Kab. Mojokerto',
      ),
    ).toEqual([
      'Lengkong Mojoanyar, Kabupaten Mojokerto',
      'Mojoanyar, Kabupaten Mojokerto',
      'Mutiara, Kabupaten Mojokerto',
    ]);
  });

  it('Kota dan Kabupaten dibedakan; "Kab." dan "Kodya" diperluas', () => {
    expect(
      buildGeocodePlan('Jl. Pahlawan, Meri, Kota Mojokerto').region?.label,
    ).toBe('Kota Mojokerto');
    expect(buildGeocodePlan('Sooko, Kab. Mojokerto').region?.label).toBe(
      'Kabupaten Mojokerto',
    );
    expect(buildGeocodePlan('Sooko, Kodya Mojokerto').region?.label).toBe(
      'Kota Mojokerto',
    );
  });

  it('"Kab." dalam berbagai cara menulis semuanya terbaca (termasuk tanpa spasi dan huruf besar)', () => {
    for (const a of [
      'Jl. Airlangga, Mojosari, Kab. Mojokerto',
      'Jl. Airlangga, Mojosari, Kab Mojokerto',
      'Jl. Airlangga, Mojosari, Kab.Mojokerto',
      'Jl. Airlangga, Mojosari, KAB. MOJOKERTO',
      'Jl. Airlangga, Mojosari, kab. mojokerto',
    ]) {
      const p = buildGeocodePlan(a);
      expect(p.region?.label).toBe('Kabupaten Mojokerto');
      expect(p.queries[0].q).toBe(
        'Jalan Airlangga, Mojosari, Kabupaten Mojokerto',
      );
    }
  });

  it('nama kabupaten/kota tanpa kata kunci diterima hanya bila ber-koma dan di bagian terakhir', () => {
    expect(qs('Gayaman, Mojokerto')).toEqual(['Gayaman, Mojokerto']);
    expect(buildGeocodePlan('Gebang Malang, Gayaman').region).toBeNull(); // "Malang" di nama desa bukan kabupaten
    expect(buildGeocodePlan('Gebang Malang').region).toBeNull();
  });

  it('tanpa kabupaten/kota = tidak lengkap, tidak ada pertanyaan sama sekali', () => {
    for (const a of [
      'Perumahan Citra Harmoni Blok F1 No.52 Trosobo Sidoarjo',
      'Jl. Ra Basuni No. 450 Sooko',
      'Ds. Singopadu RT.3 NO. 2 Tarik',
      'Jl. Pemuda No. 55B, Randubango Kec. Mojosari Jawa Timur',
      '   ',
    ]) {
      expect(buildGeocodePlan(a)).toEqual({ region: null, queries: [] });
    }
  });

  it('hanya kabupaten tanpa komponen nama = tidak ada pertanyaan', () => {
    expect(qs('Kabupaten Mojokerto')).toEqual([]);
    expect(qs('RT 02 RW 03, 61385, Kab. Mojokerto')).toEqual([]);
  });

  it('pertanyaan tidak pernah memuat nama wilayahnya sendiri sebagai komponen, dan tidak ada duplikat', () => {
    const hasil = qs('Mojokerto, Mojosari, Kabupaten Mojokerto');
    expect(hasil).toEqual(['Mojosari, Kabupaten Mojokerto']);
    expect(new Set(hasil.map((q) => q.toLowerCase())).size).toBe(hasil.length);
  });
});

describe('pickVerifiedPoint — verifikasi dua kunci', () => {
  const mojokerto = { name: 'Mojokerto', label: 'Kabupaten Mojokerto' };
  const row = (
    address: Record<string, string>,
    over: Record<string, unknown> = {},
  ) => ({
    lat: '-7.5169',
    lon: '112.5579',
    addresstype: 'road',
    address: { county: 'Mojokerto', state: 'Jawa Timur', ...address },
    ...over,
  });
  const T = (
    text: string,
    kind: 'jalan' | 'desa' | 'kecamatan' | 'perkiraan',
  ) => ({ text, kind });

  it('lolos bila wilayah cocok DAN salah satu komponen muncul di jawaban', () => {
    const r = pickVerifiedPoint(
      [row({ road: 'Jalan Airlangga', town: 'Mojosari' })],
      mojokerto,
      [T('Jalan Airlangga', 'jalan'), T('Mojosari', 'kecamatan')],
    );
    expect(r?.point).toEqual({ lat: -7.5169, lng: 112.5579 });
    expect(r?.precision).toBe('jalan'); // jenis paling spesifik yang cocok
  });

  it('ketelitian mengikuti komponen yang cocok, bukan yang diminta', () => {
    const r = pickVerifiedPoint([row({ town: 'Ngoro' })], mojokerto, [
      T('Jalan Ngoro Industri', 'jalan'),
      T('Ngoro', 'kecamatan'),
    ]);
    expect(r?.precision).toBe('kecamatan');
  });

  it('kunci 2: tempat tak berhubungan di wilayah yang benar DITOLAK (kasus "Majapahit" -> gedung di Jl. Gajah Mada)', () => {
    const gedung = {
      lat: '-7.47',
      lon: '112.43',
      addresstype: 'building',
      address: { road: 'Jalan Gajah Mada', city: 'Kota Mojokerto' },
    };
    expect(
      pickVerifiedPoint(
        [gedung],
        { name: 'Mojokerto', label: 'Kota Mojokerto' },
        [T('Majapahit', 'jalan')],
      ),
    ).toBeNull();
  });

  it('kunci 1: wilayah lain ditolak (kasus Gebang Malang -> Kabupaten Malang)', () => {
    const salah = row({ hamlet: 'Gebang', county: 'Kabupaten Malang' });
    expect(
      pickVerifiedPoint([salah], mojokerto, [T('Gebang', 'desa')]),
    ).toBeNull();
  });

  it('hasil setingkat kabupaten (tanpa nama tempat) ditolak', () => {
    expect(
      pickVerifiedPoint([row({}, { addresstype: 'county' })], mojokerto, [
        T('Sooko', 'kecamatan'),
      ]),
    ).toBeNull();
  });

  it('nama dicocokkan tanpa awalan Jalan/Desa/Kecamatan', () => {
    expect(
      pickVerifiedPoint([row({ road: 'Jalan Jayanegara' })], mojokerto, [
        T('Jayanegara', 'perkiraan'),
      ])?.precision,
    ).toBe('perkiraan');
    expect(
      pickVerifiedPoint([row({ village: 'Pohjejer' })], mojokerto, [
        T('Desa Pohjejer', 'desa'),
      ]),
    ).not.toBeNull();
  });

  it('Kabupaten dan Kota sama-sama cocok dengan nama "Mojokerto" (awalan wilayah diabaikan)', () => {
    const kota = {
      lat: '-7.49',
      lon: '112.44',
      addresstype: 'city_district',
      address: { city_district: 'Kranggan', city: 'Kota Mojokerto' },
    };
    expect(
      pickVerifiedPoint(
        [kota],
        { name: 'Mojokerto', label: 'Kota Mojokerto' },
        [T('Kranggan', 'perkiraan')],
      ),
    ).not.toBeNull();
  });

  it('memilih hasil pertama yang lolos, melewati yang salah daerah; koordinat di luar Indonesia ditolak', () => {
    const salah = row(
      { road: 'Jalan Airlangga', county: 'Kabupaten Malang' },
      { lat: '-8.3', lon: '112.4' },
    );
    const benar = row({ road: 'Jalan Airlangga' });
    expect(
      pickVerifiedPoint([salah, benar], mojokerto, [T('Airlangga', 'jalan')])
        ?.point,
    ).toEqual({ lat: -7.5169, lng: 112.5579 });
    expect(
      pickVerifiedPoint(
        [row({ road: 'Jalan Airlangga' }, { lat: '48.85', lon: '2.35' })],
        mojokerto,
        [T('Airlangga', 'jalan')],
      ),
    ).toBeNull();
    expect(pickVerifiedPoint([], mojokerto, [T('x', 'jalan')])).toBeNull();
  });
});
