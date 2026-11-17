import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JobDistanceService } from './job-distance.service';

const HIT = {
  lat: '-7.4700',
  lon: '112.4400',
  addresstype: 'road',
  address: { county: 'Mojokerto' },
};
const ADDR = 'Mojosari, Kabupaten Mojokerto';
const KEY = 'geo:mojosari, kabupaten mojokerto';

const jobsWith = (address: string) => [
  {
    id: 'j1',
    workAddress: null,
    workMapsUrl: null,
    member: { address, mapsUrl: null },
  },
];
const makeSvc = (address: string) =>
  new JobDistanceService({
    technicianJob: { findMany: jest.fn().mockResolvedValue(jobsWith(address)) },
  } as any);
const jsonRes = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  }) as unknown as Response;
const asAdmin = { id: 'u', role: 'admin' };

describe('JobDistanceService — cache file', () => {
  const realFetch = global.fetch;
  const realEnv = process.env.GEO_CACHE_FILE;
  let dir: string;
  let file: string;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'geo-cache-'));
    file = join(dir, 'sub', 'geo-cache.json'); // subfolder belum ada: harus dibuat otomatis
    process.env.GEO_CACHE_FILE = file;
    fetchMock = jest.fn().mockResolvedValue(jsonRes([HIT]));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(async () => {
    global.fetch = realFetch;
    if (realEnv === undefined) delete process.env.GEO_CACHE_FILE;
    else process.env.GEO_CACHE_FILE = realEnv;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const writeCache = async (version: number, entries: unknown) => {
    await fs.mkdir(join(dir, 'sub'), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version, entries }));
  };

  it('hasil geocoding tersimpan ke file dan dipakai instance baru tanpa panggilan jaringan', async () => {
    const a = makeSvc(ADDR);
    await a.onModuleInit(); // file belum ada: mulai kosong, tidak error
    const r1 = await a.distances(['j1'], asAdmin);
    expect(r1.items[0].state).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await a.flushCache();

    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.version).toBe(2);
    expect(Object.keys(saved.entries)).toEqual([KEY]);

    // "restart": instance baru membaca file yang sama.
    const b = makeSvc(ADDR);
    await b.onModuleInit();
    const r2 = await b.distances(['j1'], asAdmin);
    expect(r2.items[0]).toEqual(r1.items[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // tidak ada panggilan baru
  });

  it('alamat yang tidak ditemukan ikut tersimpan (negatif) supaya tidak dicari ulang', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const a = makeSvc('Entah, Kabupaten Mojokerto');
    await a.onModuleInit();
    await a.distances(['j1'], asAdmin);
    await a.flushCache();

    const b = makeSvc('Entah, Kabupaten Mojokerto');
    await b.onModuleInit();
    const r = await b.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('entri kedaluwarsa, koordinat di luar Indonesia, dan bentuk salah dibuang saat dimuat', async () => {
    const future = Date.now() + 3600_000;
    await writeCache(2, {
      'geo:kedaluwarsa, kabupaten mojokerto': {
        value: { lat: -7.47, lng: 112.44 },
        expiresAt: Date.now() - 1000,
      },
      'geo:paris, kabupaten mojokerto': {
        value: { lat: 48.85, lng: 2.35 },
        expiresAt: future,
      },
      'geo:rusak, kabupaten mojokerto': {
        value: 'bukan titik',
        expiresAt: future,
      },
      [KEY]: { value: { lat: -7.47, lng: 112.44 }, expiresAt: future },
    });
    for (const text of ['Kedaluwarsa', 'Paris', 'Rusak']) {
      const s = makeSvc(`${text}, Kabupaten Mojokerto`);
      await s.onModuleInit();
      await s.distances(['j1'], asAdmin);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // ketiganya dicari ulang
    fetchMock.mockClear();
    const ok = makeSvc(ADDR);
    await ok.onModuleInit();
    const r = await ok.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled(); // yang valid dipakai dari file
  });

  it('cache versi lama (sebelum verifikasi wilayah) dibuang seluruhnya', async () => {
    await writeCache(1, {
      [KEY]: { value: { lat: -7.47, lng: 112.44 }, expiresAt: Date.now() + 3600_000 },
    });
    const s = makeSvc(ADDR);
    await s.onModuleInit();
    await s.distances(['j1'], asAdmin);
    expect(fetchMock).toHaveBeenCalledTimes(1); // dicari ulang, titik lama tidak dipercaya
  });

  it('file cache rusak tidak membuat layanan gagal', async () => {
    await fs.mkdir(join(dir, 'sub'), { recursive: true });
    await fs.writeFile(file, '{bukan json');
    const s = makeSvc(ADDR);
    await expect(s.onModuleInit()).resolves.toBeUndefined();
    const r = await s.distances(['j1'], asAdmin);
    expect(r.items[0].state).toBe('ok');
  });

  it('tanpa onModuleInit (mis. tes lain) tidak ada file yang ditulis', async () => {
    const s = makeSvc(ADDR);
    await s.distances(['j1'], asAdmin);
    await s.flushCache();
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
