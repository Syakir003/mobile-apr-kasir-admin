import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JobDistanceService } from './job-distance.service';

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
    fetchMock = jest
      .fn()
      .mockResolvedValue(jsonRes([{ lat: '-7.4700', lon: '112.4400' }]));
    global.fetch = fetchMock;
  });
  afterEach(async () => {
    global.fetch = realFetch;
    if (realEnv === undefined) delete process.env.GEO_CACHE_FILE;
    else process.env.GEO_CACHE_FILE = realEnv;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('hasil geocoding tersimpan ke file dan dipakai instance baru tanpa panggilan jaringan', async () => {
    const a = makeSvc('Mojosari');
    await a.onModuleInit(); // file belum ada: mulai kosong, tidak error
    const r1 = await a.distances(['j1'], { id: 'u', role: 'admin' });
    expect(r1.items[0].state).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await a.flushCache();

    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(Object.keys(saved.entries)).toEqual(['geo:mojosari']);

    // "restart": instance baru membaca file yang sama.
    const b = makeSvc('Mojosari');
    await b.onModuleInit();
    const r2 = await b.distances(['j1'], { id: 'u', role: 'admin' });
    expect(r2.items[0]).toEqual(r1.items[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // tidak ada panggilan baru
  });

  it('alamat yang tidak ditemukan ikut tersimpan (negatif) supaya tidak dicari ulang', async () => {
    fetchMock.mockResolvedValue(jsonRes([]));
    const a = makeSvc('Entah di mana');
    await a.onModuleInit();
    await a.distances(['j1'], { id: 'u', role: 'admin' });
    await a.flushCache();

    const b = makeSvc('Entah di mana');
    await b.onModuleInit();
    const r = await b.distances(['j1'], { id: 'u', role: 'admin' });
    expect(r.items[0].state).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('entri kedaluwarsa, koordinat di luar Indonesia, dan bentuk salah dibuang saat dimuat', async () => {
    await fs.mkdir(join(dir, 'sub'), { recursive: true });
    const future = Date.now() + 3600_000;
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: {
          'geo:kedaluwarsa': {
            value: { lat: -7.47, lng: 112.44 },
            expiresAt: Date.now() - 1000,
          },
          'geo:paris': { value: { lat: 48.85, lng: 2.35 }, expiresAt: future },
          'geo:rusak': { value: 'bukan titik', expiresAt: future },
          'geo:mojosari': {
            value: { lat: -7.47, lng: 112.44 },
            expiresAt: future,
          },
        },
      }),
    );
    for (const text of ['Kedaluwarsa', 'Paris', 'Rusak']) {
      const s = makeSvc(text);
      await s.onModuleInit();
      await s.distances(['j1'], { id: 'u', role: 'admin' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // ketiganya dicari ulang
    fetchMock.mockClear();
    const ok = makeSvc('Mojosari');
    await ok.onModuleInit();
    const r = await ok.distances(['j1'], { id: 'u', role: 'admin' });
    expect(r.items[0].state).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled(); // yang valid dipakai dari file
  });

  it('file cache rusak tidak membuat layanan gagal', async () => {
    await fs.mkdir(join(dir, 'sub'), { recursive: true });
    await fs.writeFile(file, '{bukan json');
    const s = makeSvc('Mojosari');
    await expect(s.onModuleInit()).resolves.toBeUndefined();
    const r = await s.distances(['j1'], { id: 'u', role: 'admin' });
    expect(r.items[0].state).toBe('ok');
  });

  it('tanpa onModuleInit (mis. tes lain) tidak ada file yang ditulis', async () => {
    const s = makeSvc('Mojosari');
    await s.distances(['j1'], { id: 'u', role: 'admin' });
    await s.flushCache();
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
