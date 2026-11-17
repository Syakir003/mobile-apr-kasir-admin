import { JobDistanceService } from './job-distance.service';
import { MAPS_SEARCH_PREFIX } from '../common/maps-url.util';

// Jawaban Nominatim yang lolos kedua verifikasi: wilayah Mojokerto + memuat nama tempat yang dicari.
const hit = (field: string, name: string, county = 'Mojokerto') => ({
  lat: '-7.4700',
  lon: '112.4400',
  addresstype: field,
  address: { county, state: 'Jawa Timur', [field]: name },
});
// Jawaban dari daerah lain bernama mirip (kasus "Gebang Malang" jatuh ke Kabupaten Malang).
const SALAH_DAERAH = {
  lat: '-8.3429',
  lon: '112.49235',
  addresstype: 'hamlet',
  address: {
    county: 'Kabupaten Malang',
    hamlet: 'Gebang',
    state: 'Jawa Timur',
  },
};

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
const withAddress = (id: string, address: string) =>
  job(id, { member: { address, mapsUrl: null } });

const jsonRes = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  }) as unknown as Response;
const queryOf = (fetchMock: jest.Mock, call: number) =>
  new URL(String(fetchMock.mock.calls[call][0])).searchParams.get('q');

const asAdmin = { id: 'u1', role: 'admin' };

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

  it('koordinat di link Maps dipakai langsung, tanpa panggilan jaringan, ketelitian "titik"', async () => {
    const { svc } = setup([
      job('j1', {
        member: {
          address: null,
          mapsUrl: 'https://www.google.com/maps/@-7.4700,112.4400,17z',
        },
      }),
    ]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.items[0].state).toBe('ok');
    expect(r.items[0].precision).toBe('titik');
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
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0].km).toBeLessThan(5);
  });

  it('link pencarian buatan sistem digeocode dari teksnya, hasil di-cache', async () => {
    fetchMock.mockResolvedValue(jsonRes([hit('town', 'Mojosari')]));
    const url =
      MAPS_SEARCH_PREFIX + encodeURIComponent('Mojosari, Kabupaten Mojokerto');
    const { svc } = setup([
      job('j1', { member: { address: null, mapsUrl: url } }),
    ]);

    const a = await svc.distances(['j1'], asAdmin);
    const b = await svc.distances(['j1'], asAdmin);

    expect(a.items[0].state).toBe('ok');
    expect(a.items[0].precision).toBe('kecamatan');
    expect(b.items[0].km).toBe(a.items[0].km);
    expect(b.items[0].precision).toBe('kecamatan'); // ketelitian ikut tersimpan di cache
    expect(fetchMock).toHaveBeenCalledTimes(1); // panggilan kedua dari cache
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('nominatim.openstreetmap.org');
    expect(queryOf(fetchMock, 0)).toBe('Mojosari, Kabupaten Mojokerto');
    expect(new URL(calledUrl).searchParams.get('addressdetails')).toBe('1');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe(
      'epos-ac-antrian-servis/1.0',
    );
  });

  it('dua job beralamat sama hanya satu panggilan geocoding', async () => {
    fetchMock.mockResolvedValue(jsonRes([hit('town', 'Krian', 'Sidoarjo')]));
    const m = { address: 'Krian, Kabupaten Sidoarjo', mapsUrl: null };
    const { svc } = setup([job('j1', { member: m }), job('j2', { member: m })]);
    const r = await svc.distances(['j1', 'j2'], asAdmin);
    expect(r.items.map((i) => i.state)).toEqual(['ok', 'ok']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Nominatim 429 = pending (tidak di-cache) lalu dijeda; permintaan berikutnya tidak menembak lagi', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 429));
    const { svc } = setup([withAddress('j1', 'Gedeg, Kabupaten Mojokerto')]);
    const a = await svc.distances(['j1'], asAdmin);
    const b = await svc.distances(['j1'], asAdmin);
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
    const r = await svc.distances(['j1'], asAdmin);
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
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
    expect(r.items[0].precision).toBe('titik');
  });
});

describe('JobDistanceService — cakupan dikecilkan dan dua verifikasi', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('pencarian lengkap kosong -> dikecilkan ke bagian belakang sampai ketemu', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes([])) // jalan + kelurahan: kosong
      .mockResolvedValueOnce(jsonRes([hit('village', 'Kuwung')])); // kelurahan saja: ketemu
    const { svc } = setup([
      withAddress(
        'j1',
        'Gg. Mawar No. 5 RT 02 RW 03, Kuwung, Kabupaten Mojokerto',
      ),
    ]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queryOf(fetchMock, 0)).toBe(
      'Gang Mawar, Kuwung, Kabupaten Mojokerto',
    );
    expect(queryOf(fetchMock, 1)).toBe('Kuwung, Kabupaten Mojokerto');
  });

  it('kode pos dan provinsi tidak ikut dikirim ke peta', async () => {
    fetchMock.mockResolvedValue(jsonRes([hit('road', 'Jalan Pahlawan')]));
    const { svc } = setup([
      withAddress(
        'j1',
        'Jl. Pahlawan, Ngoro, Kabupaten Mojokerto, Jawa Timur 61385',
      ),
    ]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(queryOf(fetchMock, 0)).toBe(
      'Jalan Pahlawan, Ngoro, Kabupaten Mojokerto',
    );
    expect(r.items[0]).toMatchObject({ state: 'ok', precision: 'jalan' });
  });

  it('nama ruko dilewati: jalan + daerah dicari bersama (kasus Jl. Airlangga)', async () => {
    fetchMock.mockResolvedValue(jsonRes([hit('road', 'Jalan Airlangga')]));
    const { svc } = setup([
      withAddress(
        'j1',
        'Jl. Airlangga no. 55 Ruko Royal RD-06, Mojosari, Kab. Mojokerto',
      ),
    ]);
    await svc.distances(['j1'], asAdmin);
    expect(queryOf(fetchMock, 0)).toBe(
      'Jalan Airlangga, Mojosari, Kabupaten Mojokerto',
    );
  });

  it('kunci 1: hasil dari daerah lain ditolak lalu lanjut ke pertanyaan berikutnya (kasus Gebang Malang)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes([SALAH_DAERAH])) // Kabupaten Malang: ditolak
      .mockResolvedValueOnce(jsonRes([hit('village', 'Gayaman')]));
    const { svc } = setup([
      withAddress('j1', 'Gebang Malang, Gayaman, Kabupaten Mojokerto'),
    ]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
    expect(r.items[0].km).toBeLessThan(10); // bukan ±100 km dari Kabupaten Malang
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('kunci 2: wilayah benar tapi tempatnya tak berhubungan dengan alamat = ditolak', async () => {
    fetchMock.mockResolvedValue(jsonRes([hit('road', 'Jalan Raya Lain')]));
    const { svc } = setup([withAddress('j1', 'Sooko, Kabupaten Mojokerto')]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0]).toMatchObject({
      state: 'unknown',
      reason: 'not_found',
      km: null,
    });
  });

  it('hasil setingkat kabupaten (tanpa nama tempat) ditolak', async () => {
    fetchMock.mockResolvedValue(
      jsonRes([
        {
          lat: '-7.47',
          lon: '112.44',
          addresstype: 'county',
          address: { county: 'Mojokerto' },
        },
      ]),
    );
    const { svc } = setup([withAddress('j1', 'Sooko, Kabupaten Mojokerto')]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0]).toMatchObject({ state: 'unknown', reason: 'not_found' });
  });

  it('koordinat di luar Indonesia ditolak', async () => {
    fetchMock.mockResolvedValue(
      jsonRes([{ ...hit('town', 'Paris'), lat: '48.85', lon: '2.35' }]),
    );
    const { svc } = setup([withAddress('j1', 'Paris, Kabupaten Mojokerto')]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0]).toMatchObject({ state: 'unknown', reason: 'not_found' });
  });

  it('semua pertanyaan kosong = not_found, dan tidak dicari ulang (cache per pertanyaan)', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    // Tiga pertanyaan (jalan+kelurahan, kelurahan, jalan): selesai dalam anggaran waktu satu permintaan.
    const { svc } = setup([
      withAddress('j1', 'Gg. Mawar, Kuwung, Kota Mojokerto'),
    ]);
    const a = await svc.distances(['j1'], asAdmin);
    expect(a.items[0]).toMatchObject({ state: 'unknown', reason: 'not_found' });
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(3);
    await svc.distances(['j1'], asAdmin);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('tanpa kabupaten/kota = unknown/incomplete, TANPA panggilan jaringan', async () => {
    const { svc } = setup([
      withAddress('j1', 'Jl. Ra Basuni No. 450 Sooko'),
      withAddress('j2', 'Gebang Malang'),
      withAddress('j3', 'Kabupaten Mojokerto'), // hanya wilayah, tanpa komponen nama
      withAddress(
        'j4',
        'Perumahan Citra Harmoni Blok F1 No.52 Trosobo Sidoarjo',
      ),
    ]);
    const r = await svc.distances(['j1', 'j2', 'j3', 'j4'], asAdmin);
    expect(r.items.map((i) => [i.state, i.reason])).toEqual([
      ['unknown', 'incomplete'],
      ['unknown', 'incomplete'],
      ['unknown', 'incomplete'],
      ['unknown', 'incomplete'],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tanpa alamat dan tanpa link = unknown/no_address, tanpa panggilan jaringan', async () => {
    const { svc } = setup([job('j1')]);
    const r = await svc.distances(['j1'], asAdmin);
    expect(r.items[0]).toMatchObject({
      state: 'unknown',
      reason: 'no_address',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('layanan menolak (403) = unknown/service_error, tidak menebak versi lain dan tidak di-cache', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 403));
    const { svc } = setup([
      withAddress('j1', 'Gg. Mawar, Kuwung, Meri, Kota Mojokerto'),
    ]);
    const a = await svc.distances(['j1'], asAdmin);
    expect(a.items[0]).toMatchObject({
      state: 'unknown',
      reason: 'service_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await svc.distances(['j1'], asAdmin);
    expect(fetchMock).toHaveBeenCalledTimes(2); // dicoba lagi, bukan diingat sebagai "tidak ditemukan"
  });
});
