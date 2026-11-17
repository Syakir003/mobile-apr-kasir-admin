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

describe('buildGeocodePlan', () => {
  it('format yang dianjurkan: jalan, desa, kabupaten -> dari lengkap ke umum', () => {
    const p = buildGeocodePlan(
      'Jl. Airlangga No. 55, Mojosari, Kabupaten Mojokerto',
    );
    expect(p.region).toEqual({
      name: 'Mojokerto',
      label: 'Kabupaten Mojokerto',
    });
    expect(p.queries).toEqual([
      'Jalan Airlangga, Mojosari, Kabupaten Mojokerto',
      'Mojosari, Kabupaten Mojokerto',
    ]);
  });

  it('nama ruko/kompleks dilewati, jalan dan daerah tetap dicari bersama', () => {
    const p = buildGeocodePlan(
      'Jl. Airlangga No. 55 Ruko Royal RD-06, Mojosari, Kab. Mojokerto',
    );
    expect(p.queries[0]).toBe('Jalan Airlangga, Mojosari, Kabupaten Mojokerto');
    expect(p.queries.join(' ')).not.toMatch(/Ruko|Royal/);
  });

  it('alamat lama tanpa koma: jalan + kata terakhir muncul setelah nama ruko dilewati', () => {
    const p = buildGeocodePlan(
      'Jl. Airlangga no. 55 Ruko Royal RD-06 Mojosari Kab. Mojokerto',
    );
    expect(p.queries).toContain(
      'Jalan Airlangga Mojosari, Kabupaten Mojokerto',
    );
    expect(p.queries).toContain('Mojosari, Kabupaten Mojokerto');
    expect(p.queries.every((q) => q.endsWith('Kabupaten Mojokerto'))).toBe(
      true,
    );
  });

  it('"Kab." diperluas jadi "Kabupaten"; "Kec." dan "Ds." dibuang; RT/RW, nomor, blok dibuang', () => {
    const p = buildGeocodePlan(
      'Jl. Raya Mojosari No. 12 RT.02/RW.03, Dsn. Kemlagi, Kec. Mojosari, Kab. Mojokerto',
    );
    expect(p.queries[0]).toBe(
      'Jalan Raya Mojosari, Kemlagi, Mojosari, Kabupaten Mojokerto',
    );
    expect(p.queries).toContain('Kemlagi, Mojosari, Kabupaten Mojokerto');
    expect(p.queries).toContain('Mojosari, Kabupaten Mojokerto');
    expect(p.queries.length).toBeLessThanOrEqual(5);
  });

  it('Kota dan Kabupaten dibedakan; "Jawa Timur" di belakang diabaikan', () => {
    expect(
      buildGeocodePlan('Jl. Pahlawan, Meri, Kota Mojokerto, Jawa Timur').region,
    ).toEqual({
      name: 'Mojokerto',
      label: 'Kota Mojokerto',
    });
    expect(buildGeocodePlan('Sooko, Kab. Mojokerto').region?.label).toBe(
      'Kabupaten Mojokerto',
    );
  });

  it('nama kabupaten/kota tanpa kata kunci diterima hanya bila ber-koma dan di bagian terakhir', () => {
    expect(buildGeocodePlan('Gayaman, Mojokerto').region?.name).toBe(
      'Mojokerto',
    );
    expect(buildGeocodePlan('Gayaman, Mojokerto').queries).toEqual([
      'Gayaman, Mojokerto',
    ]);
    // "Malang" di tengah nama desa BUKAN kabupaten: tidak lengkap.
    expect(buildGeocodePlan('Gebang Malang, Gayaman').region).toBeNull();
    expect(buildGeocodePlan('Gebang Malang').region).toBeNull();
  });

  it('tanpa kabupaten/kota = tidak lengkap, tidak ada pertanyaan sama sekali', () => {
    for (const a of [
      'Jl. Ra Basuni No. 450 Sooko',
      'Ds. Singopadu RT.3 NO. 2 Tarik',
      'Jl. Pemuda No. 55B, Randubango Kec. Mojosari Jawa Timur',
      'Sumbersroyo Kebonagung puri',
      '   ',
    ]) {
      expect(buildGeocodePlan(a)).toEqual({ region: null, queries: [] });
    }
  });

  it('hanya kabupaten tanpa bagian spesifik = tidak ada pertanyaan', () => {
    expect(buildGeocodePlan('Kabupaten Mojokerto').queries).toEqual([]);
    expect(buildGeocodePlan('RT 02 RW 03, Kab. Mojokerto').queries).toEqual([]);
  });

  it('desa dan kecamatan menyatu tanpa koma: kata terakhir dicoba sendiri sebagai cadangan terakhir', () => {
    const p = buildGeocodePlan(
      'Jl. Pemuda No. 55B, Randubango Kec. Mojosari Kab. Mojokerto',
    );
    expect(p.queries).toEqual([
      'Jalan Pemuda, Randubango Mojosari, Kabupaten Mojokerto',
      'Randubango Mojosari, Kabupaten Mojokerto',
      'Mojosari, Kabupaten Mojokerto',
    ]);
  });

  it('kasus nyata: alamat panjang berbagai bentuk selalu berakhir dengan wilayah yang ditulis', () => {
    const cases: [string, string][] = [
      [
        'Pohjejer Kec. Gondang Kab. Mojokerto',
        'Pohjejer Gondang, Kabupaten Mojokerto',
      ],
      [
        'Jalan Jayanegara No. 219 Banjaragung Kec. Puri Kab. Mojokerto',
        'Banjaragung Puri, Kabupaten Mojokerto',
      ],
      [
        'Ngoro Industri Persada Blok J no.8 Ngoro Kab. Mojokerto',
        'Ngoro, Kabupaten Mojokerto',
      ],
      [
        'Perumahan Mutiara Garden blok C -12 , Lengkong Mojoanyar Kab. Mojokerto',
        'Lengkong Mojoanyar, Kabupaten Mojokerto',
      ],
      ['GebangMalang, Gayaman Kab. Mojokerto', 'Gayaman, Kabupaten Mojokerto'],
    ];
    for (const [alamat, harusAda] of cases) {
      const p = buildGeocodePlan(alamat);
      expect(p.region?.label).toBe('Kabupaten Mojokerto');
      expect(p.queries.length).toBeGreaterThan(0);
      expect(p.queries.length).toBeLessThanOrEqual(5);
      expect(p.queries).toContain(harusAda);
    }
  });
});

describe('pickVerifiedPoint — verifikasi dua kunci', () => {
  const mojokerto = { name: 'Mojokerto', label: 'Kabupaten Mojokerto' };
  const row = (over: Record<string, unknown> = {}) => ({
    lat: '-7.5169',
    lon: '112.5579',
    addresstype: 'trunk',
    address: { county: 'Mojokerto', state: 'Jawa Timur' },
    ...over,
  });

  it('menerima hasil spesifik yang wilayahnya cocok', () => {
    expect(pickVerifiedPoint([row()], mojokerto)).toEqual({
      lat: -7.5169,
      lng: 112.5579,
    });
  });

  it('Kabupaten dan Kota Mojokerto sama-sama cocok dengan nama "Mojokerto" (awalan diabaikan)', () => {
    const kota = row({ address: { city: 'Kota Mojokerto' } });
    expect(pickVerifiedPoint([kota], mojokerto)).not.toBeNull();
    const kab = row({ address: { county: 'Kabupaten Malang' } });
    expect(
      pickVerifiedPoint([kab], { name: 'Malang', label: 'Kabupaten Malang' }),
    ).not.toBeNull();
  });

  it('menolak hasil dari daerah lain (kasus "Gebang Malang" jatuh ke Kabupaten Malang)', () => {
    const salah = row({
      lat: '-8.3429',
      lon: '112.49235',
      addresstype: 'hamlet',
      address: { county: 'Kabupaten Malang' },
    });
    expect(pickVerifiedPoint([salah], mojokerto)).toBeNull();
  });

  it('menolak hasil setingkat wilayah saja (titik pusat kabupaten sama untuk semua pelanggan)', () => {
    expect(
      pickVerifiedPoint([row({ addresstype: 'county' })], mojokerto),
    ).toBeNull();
    expect(
      pickVerifiedPoint(
        [row({ addresstype: 'city', address: { city: 'Kota Mojokerto' } })],
        mojokerto,
      ),
    ).toBeNull();
  });

  it('memilih hasil pertama yang lolos, melewati yang salah daerah', () => {
    const salah = row({
      lat: '-8.3',
      lon: '112.4',
      address: { county: 'Kabupaten Malang' },
    });
    expect(pickVerifiedPoint([salah, row()], mojokerto)).toEqual({
      lat: -7.5169,
      lng: 112.5579,
    });
  });

  it('menolak koordinat di luar Indonesia dan daftar kosong', () => {
    expect(
      pickVerifiedPoint([row({ lat: '48.85', lon: '2.35' })], mojokerto),
    ).toBeNull();
    expect(pickVerifiedPoint([], mojokerto)).toBeNull();
  });
});
