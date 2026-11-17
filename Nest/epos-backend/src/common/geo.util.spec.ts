import {
  geocodeQueryCandidates,
  haversineKm,
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

describe('geocodeQueryCandidates', () => {
  it('alamat pendek: satu kandidat saja', () => {
    expect(geocodeQueryCandidates('Mojosari')).toEqual(['Mojosari']);
    // Awalan "Dusun/Desa/Kel./Kec." dibuang (menyulitkan Nominatim); namanya dipertahankan.
    expect(geocodeQueryCandidates('Dusun Krian')).toEqual(['Krian']);
  });

  it('dua bagian: alamat penuh lalu bagian daerahnya', () => {
    expect(geocodeQueryCandidates('Kuwung, Meri Kota Mojokerto')).toEqual([
      'Kuwung, Meri Kota Mojokerto',
      'Meri Kota Mojokerto',
    ]);
  });

  it('membuang RT/RW, nomor rumah, blok, dan singkatan wilayah, lalu menyederhanakan bertahap', () => {
    const c = geocodeQueryCandidates(
      'Jl. Raya Mojosari No. 12 RT.02/RW.03, Dsn. Kemlagi, Kec. Mojosari, Kab. Mojokerto',
    );
    expect(c[0]).toBe('Jl. Raya Mojosari, Kemlagi, Mojosari, Kab. Mojokerto');
    expect(c).toContain('Kemlagi, Mojosari, Kab. Mojokerto');
    expect(c).toContain('Mojosari, Kab. Mojokerto');
    expect(c.length).toBeLessThanOrEqual(3);
  });

  it('format RT/RW lain dan nomor berhuruf', () => {
    expect(
      geocodeQueryCandidates('Perum Griya Blok A5 No 7B RT 02 RW 03 Sooko Mojokerto')[0],
    ).toBe('Perum Griya Sooko Mojokerto');
    expect(geocodeQueryCandidates('Jl. Melati RT/RW 02/03, Meri')[0]).toBe('Jl. Melati, Meri');
  });

  it('tanpa koma dan panjang: dikurangi dari depan dan dari belakang', () => {
    const c = geocodeQueryCandidates('Perumahan Pondok Indah Sooko Kabupaten Mojokerto');
    expect(c[0]).toBe('Perumahan Pondok Indah Sooko Kabupaten Mojokerto');
    expect(c[1]).toBe('Pondok Indah Sooko Kabupaten Mojokerto');
    expect(c[2]).toBe('Sooko Kabupaten Mojokerto');
  });

  it('Kota dan Kabupaten dipertahankan (membedakan dua daerah)', () => {
    expect(geocodeQueryCandidates('Meri Kota Mojokerto')[0]).toContain('Kota');
    expect(geocodeQueryCandidates('Sooko Kab. Mojokerto')[0]).toContain('Kab.');
  });

  it('kosong -> tanpa kandidat; semua noise -> kembali ke teks asli', () => {
    expect(geocodeQueryCandidates('   ')).toEqual([]);
    expect(geocodeQueryCandidates('RT 02 RW 03')).toEqual(['RT 02 RW 03']);
  });
});
