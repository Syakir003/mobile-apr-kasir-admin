import { JobDistanceService } from './job-distance.service';
import { MAPS_SEARCH_PREFIX } from '../common/maps-url.util';

// Titik di sekitar toko supaya jaraknya kecil dan mudah dipastikan.
const NEAR = { lat: '-7.4700', lon: '112.4400' };

function setup(jobs: any[]) {
  const findMany = jest.fn().mockResolvedValue(jobs);
  const prisma = { technicianJob: { findMany } } as any;
  return { svc: new JobDistanceService(prisma), findMany };
}

const job = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  workAddress: null,
  workMapsUrl: null,
  member: { address: null, mapsUrl: null },
  ...over,
});

const jsonRes = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  }) as unknown as Response;

describe('JobDistanceService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('koordinat di link Maps dipakai langsung, tanpa panggilan jaringan', async () => {
    const { svc } = setup([
      job('j1', {
        member: {
          address: null,
          mapsUrl: 'https://www.google.com/maps/@-7.4700,112.4400,17z',
        },
      }),
    ]);
    const r = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.items[0].state).toBe('ok');
    expect(r.items[0].km).toBeGreaterThan(1);
    expect(r.items[0].km).toBeLessThan(5);
  });

  it('titik lokasi kerja menang atas alamat/link member', async () => {
    const { svc } = setup([
      job('j1', {
        workAddress: 'Titik kerja',
        workMapsUrl: 'https://www.google.com/maps/@-7.4700,112.4400,17z',
        member: {
          address: 'Jauh',
          mapsUrl: 'https://www.google.com/maps/@-6.2,106.8,17z',
        },
      }),
    ]);
    const r = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(r.items[0].km).toBeLessThan(5);
  });

  it('link pencarian buatan sistem digeocode dari teksnya, hasil di-cache', async () => {
    fetchMock.mockResolvedValue(jsonRes([NEAR]));
    const url = MAPS_SEARCH_PREFIX + encodeURIComponent('Mojosari Mojokerto');
    const { svc } = setup([
      job('j1', { member: { address: null, mapsUrl: url } }),
    ]);

    const a = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    const b = await svc.distances(['j1'], { id: 'u1', role: 'admin' });

    expect(a.items[0].state).toBe('ok');
    expect(b.items[0].km).toBe(a.items[0].km);
    expect(fetchMock).toHaveBeenCalledTimes(1); // panggilan kedua dari cache
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('nominatim.openstreetmap.org');
    expect(new URL(calledUrl).searchParams.get('q')).toBe('Mojosari Mojokerto');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(
      'epos-ac-antrian-servis/1.0',
    );
  });

  it('dua job beralamat sama hanya satu panggilan geocoding', async () => {
    fetchMock.mockResolvedValue(jsonRes([NEAR]));
    const m = { address: 'Dusun Krian', mapsUrl: null };
    const { svc } = setup([job('j1', { member: m }), job('j2', { member: m })]);
    const r = await svc.distances(['j1', 'j2'], { id: 'u1', role: 'admin' });
    expect(r.items.map((i) => i.state)).toEqual(['ok', 'ok']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('alamat tidak ditemukan = unknown (dan di-cache), tanpa alamat sama sekali = unknown tanpa jaringan', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const { svc } = setup([
      job('j1', { member: { address: 'Entah di mana', mapsUrl: null } }),
      job('j2', { member: { address: null, mapsUrl: null } }),
    ]);
    const r = await svc.distances(['j1', 'j2'], { id: 'u1', role: 'admin' });
    expect(r.items.map((i) => [i.state, i.km])).toEqual([
      ['unknown', null],
      ['unknown', null],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hasil geocoding di luar Indonesia ditolak', async () => {
    fetchMock.mockResolvedValue(jsonRes([{ lat: '48.85', lon: '2.35' }]));
    const { svc } = setup([
      job('j1', { member: { address: 'Paris', mapsUrl: null } }),
    ]);
    const r = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(r.items[0].state).toBe('unknown');
  });

  it('Nominatim 429 = pending (tidak di-cache) lalu dijeda; permintaan berikutnya tidak menembak lagi', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 429));
    const { svc } = setup([
      job('j1', { member: { address: 'Gedeg', mapsUrl: null } }),
    ]);
    const a = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    const b = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(a.items[0].state).toBe('pending');
    expect(b.items[0].state).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('teknisi hanya mendapat job miliknya; job lain tidak muncul di hasil', async () => {
    const { svc, findMany } = setup([]);
    const r = await svc.distances(['x1'], { id: 'tek1', role: 'teknisi' });
    expect(r.items).toEqual([]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['x1'] },
      assignees: { some: { technicianId: 'tek1' } },
    });
  });

  it('link pendek hanya diikuti ke host Google; host lain tidak dibuka', async () => {
    // Redirect pertama menuju host asing: tidak boleh ada fetch kedua ke host itu.
    const res = (location: string) =>
      ({
        status: 302,
        ok: false,
        headers: new Headers({ location }),
        json: async () => ({}),
      }) as unknown as Response;
    fetchMock.mockResolvedValueOnce(res('https://evil.example.com/steal'));
    const { svc } = setup([
      job('j1', {
        member: { address: null, mapsUrl: 'https://maps.app.goo.gl/abc123' },
      }),
    ]);
    const r = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(r.items[0].state).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://maps.app.goo.gl/abc123',
    );
  });

  it('link pendek yang mengarah ke link berkoordinat terbaca', async () => {
    const res = (location: string) =>
      ({
        status: 302,
        ok: false,
        headers: new Headers({ location }),
        json: async () => ({}),
      }) as unknown as Response;
    fetchMock.mockResolvedValueOnce(
      res('https://www.google.com/maps/place/X/@-7.4700,112.4400,17z'),
    );
    const { svc } = setup([
      job('j1', {
        member: { address: null, mapsUrl: 'https://maps.app.goo.gl/abc123' },
      }),
    ]);
    const r = await svc.distances(['j1'], { id: 'u1', role: 'admin' });
    expect(r.items[0].state).toBe('ok');
  });
});

describe('JobDistanceService — alamat panjang dan alasan gagal', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  const asAdmin = { id: 'u1', role: 'admin' };

  it('alamat lengkap yang kosong dicoba lagi dalam versi lebih sederhana sampai ketemu', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes([])) // versi lengkap: kosong
      .mockResolvedValueOnce(jsonRes([NEAR])); // tanpa bagian depan: ketemu
    const { svc } = setup([
      job('j1', {
        member: { address: 'Gg. Mawar No. 5 RT 02 RW 03, Kuwung, Meri, Kota Mojokerto', mapsUrl: null },
      }),
    ]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const q1 = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('q');
    const q2 = new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('q');
    expect(q1).not.toMatch(/\bRT\b|\bRW\b|\bNo\b/i); // noise dibuang sejak percobaan pertama
    expect(q2!.length).toBeLessThan(q1!.length);
  });

  it('semua versi kosong = unknown/not_found, dan tidak dicari ulang (cache per kandidat)', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const { svc } = setup([
      job('j1', { member: { address: 'Gg. Mawar, Kuwung, Meri, Kota Mojokerto', mapsUrl: null } }),
    ]);
    const a = await svc.distances(['j1'], asAdmin);
    expect(a.items[0]).toMatchObject({ state: 'unknown', reason: 'not_found' });
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
    await svc.distances(['j1'], asAdmin);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('tanpa alamat dan tanpa link = unknown/no_address, tanpa panggilan jaringan', async () => {
    const { svc } = setup([job('j1')]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0]).toMatchObject({ state: 'unknown', reason: 'no_address' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('layanan menolak (403) = unknown/service_error, tidak menebak versi lain dan tidak di-cache', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 403));
    const { svc } = setup([
      job('j1', { member: { address: 'Gg. Mawar, Kuwung, Meri, Kota Mojokerto', mapsUrl: null } }),
    ]);
    const a = await svc.distances(['j1'], asAdmin);
    expect(a.items[0]).toMatchObject({ state: 'unknown', reason: 'service_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await svc.distances(['j1'], asAdmin);
    expect(fetchMock).toHaveBeenCalledTimes(2); // dicoba lagi, bukan diingat sebagai "tidak ditemukan"
  });
});
