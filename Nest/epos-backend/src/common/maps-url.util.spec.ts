import { MAPS_SEARCH_PREFIX, normalizeMapsInput } from './maps-url.util';

// Isian link lokasi boleh link ATAU ketikan biasa; yang disimpan selalu URL yang bisa dibuka.
describe('normalizeMapsInput', () => {
  it('kosong atau spasi saja = tanpa link (null)', () => {
    expect(normalizeMapsInput('')).toBeNull();
    expect(normalizeMapsInput('   ')).toBeNull();
  });

  it('link http/https dibiarkan (dirapikan spasinya)', () => {
    expect(normalizeMapsInput('  https://maps.app.goo.gl/abc  ')).toBe('https://maps.app.goo.gl/abc');
    expect(normalizeMapsInput('http://example.com/x')).toBe('http://example.com/x');
  });

  it('domain peta tanpa skema diberi https://', () => {
    expect(normalizeMapsInput('maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc');
    expect(normalizeMapsInput('goo.gl/maps/xyz')).toBe('https://goo.gl/maps/xyz');
    expect(normalizeMapsInput('www.google.com/maps/place/Mojokerto')).toBe('https://www.google.com/maps/place/Mojokerto');
    expect(normalizeMapsInput('maps.google.com/?q=Mojokerto')).toBe('https://maps.google.com/?q=Mojokerto');
  });

  it('ketikan biasa (nama daerah/tempat/alamat) jadi link pencarian Google Maps', () => {
    expect(normalizeMapsInput('Mojokerto kota')).toBe(MAPS_SEARCH_PREFIX + 'Mojokerto%20kota');
    expect(normalizeMapsInput('Jl. Melati No. 5, Gedeg')).toBe(MAPS_SEARCH_PREFIX + encodeURIComponent('Jl. Melati No. 5, Gedeg'));
    // kata tunggal bertitik yang bukan domain peta tetap dicari sebagai teks
    expect(normalizeMapsInput('Ruko.Gedeg')).toBe(MAPS_SEARCH_PREFIX + 'Ruko.Gedeg');
  });

  it('teks yang kelewat panjang dipotong supaya link tidak melebihi batas penyimpanan', () => {
    const out = normalizeMapsInput('a'.repeat(400)) as string;
    expect(out).toBe(MAPS_SEARCH_PREFIX + 'a'.repeat(150));
    expect(out.length).toBeLessThan(500);
  });

  it('hasilnya idempotent: menormalkan hasil normalisasi tidak mengubahnya lagi', () => {
    const once = normalizeMapsInput('Mojokerto kota') as string;
    expect(normalizeMapsInput(once)).toBe(once);
  });

  it('nilai bukan string dikembalikan apa adanya (biar validator yang menolak)', () => {
    expect(normalizeMapsInput(undefined)).toBeUndefined();
    expect(normalizeMapsInput(123)).toBe(123);
    expect(normalizeMapsInput(null)).toBeNull();
  });
});
