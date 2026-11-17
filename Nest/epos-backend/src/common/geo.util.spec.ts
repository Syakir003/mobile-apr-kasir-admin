import { haversineKm, parseCoordsFromMapsUrl, searchTextFromMapsUrl, SHOP_LOCATION } from './geo.util';
import { MAPS_SEARCH_PREFIX, normalizeMapsInput } from './maps-url.util';

describe('parseCoordsFromMapsUrl', () => {
  it('membaca @lat,lng dari link tempat', () => {
    expect(parseCoordsFromMapsUrl('https://www.google.com/maps/place/Toko/@-7.4738,112.4556,17z/data=!4m6')).toEqual({
      lat: -7.4738,
      lng: 112.4556,
    });
  });

  it('pin presisi !3d!4d menang atas @ (yang @ itu titik tengah peta)', () => {
    const url = 'https://www.google.com/maps/place/X/@-7.5,112.5,15z/data=!3d-7.4701!4d112.4402';
    expect(parseCoordsFromMapsUrl(url)).toEqual({ lat: -7.4701, lng: 112.4402 });
  });

  it('membaca q=lat,lng dan query=lat,lng (termasuk yang di-encode)', () => {
    expect(parseCoordsFromMapsUrl('https://maps.google.com/?q=-7.47,112.45')).toEqual({ lat: -7.47, lng: 112.45 });
    expect(parseCoordsFromMapsUrl('https://www.google.com/maps/search/?api=1&query=-7.47%2C112.45')).toEqual({
      lat: -7.47,
      lng: 112.45,
    });
  });

  it('link pencarian teks buatan sistem TIDAK punya koordinat', () => {
    expect(parseCoordsFromMapsUrl(normalizeMapsInput('Mojosari Mojokerto') as string)).toBeNull();
  });

  it('menolak angka di luar Indonesia dan input kosong', () => {
    expect(parseCoordsFromMapsUrl('https://www.google.com/maps/@48.85,2.35,12z')).toBeNull();
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
