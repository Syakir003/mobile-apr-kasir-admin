import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  geocodeQueryCandidates,
  haversineKm,
  parseCoordsFromMapsUrl,
  searchTextFromMapsUrl,
  SHOP_LOCATION,
  validLatLng,
  type LatLng,
} from '../common/geo.util';
import { assignedTo } from './job-assignees';

export type JobDistanceState = 'ok' | 'unknown' | 'pending';
/**
 * Kenapa jarak tidak diketahui: 'no_address' = job tanpa alamat/link; 'not_found' = alamat ada tapi tidak ditemukan di peta
 * (semua versi sederhananya sudah dicoba); 'service_error' = layanan peta menolak/gagal (mis. diblokir), bisa dicoba lagi.
 */
export type JobDistanceReason = 'no_address' | 'not_found' | 'service_error';
export interface JobDistanceItem {
  jobId: string;
  /** Jarak garis lurus dari toko (km, 1 desimal); null bila belum/tidak diketahui. */
  km: number | null;
  state: JobDistanceState;
  /** Hanya untuk state 'unknown'. */
  reason?: JobDistanceReason;
}

// Host link pendek yang boleh dibuka server untuk membaca tujuan akhirnya (pengaman SSRF: selain ini tidak diikuti).
const SHORT_LINK_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.page|share\.google)$/i;
const GOOGLE_MAPS_HOST = /^((www|maps)\.)?google\.[a-z.]+$/i;
const MAX_REDIRECT_HOPS = 5;

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Kebijakan Nominatim: maksimal 1 permintaan/detik dan User-Agent yang mengidentifikasi aplikasi (tanpa data pribadi).
const NOMINATIM_GAP_MS = 1100;
const USER_AGENT = 'epos-ac-antrian-servis/1.0';

// Anggaran waktu satu permintaan: alamat yang belum sempat dihitung dikembalikan 'pending' (frontend mencoba lagi).
// Pendek sengaja: hasil yang sudah ada langsung kembali ke layar dan sisanya dilanjutkan di permintaan berikutnya
// (cache menyimpan yang sudah selesai), jadi daftar terurut bertahap alih-alih menunggu semua alamat.
const TIME_BUDGET_MS = 4_000;
const TTL_FOUND_MS = 30 * 24 * 3600_000;
const TTL_NOT_FOUND_MS = 24 * 3600_000;
const BACKOFF_MS = 60_000;
const CACHE_MAX = 5000;

interface CacheEntry {
  value: LatLng | null;
  expiresAt: number;
}
/** Hasil resolusi satu alamat: titik, tidak ditemukan, atau belum selesai (anggaran waktu habis / layanan sibuk). */
type Resolved =
  | { kind: 'ok'; point: LatLng }
  | { kind: 'unknown'; reason: JobDistanceReason }
  | { kind: 'pending' };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Jarak job ke toko untuk pengurutan "Terdekat" di Antrian Servis. Tidak ada koordinat di database, jadi titik tiap job
 * dicari dari: (1) koordinat di link Maps (pin/share), (2) tujuan akhir link pendek maps.app.goo.gl, (3) geocoding teks
 * alamat lewat OpenStreetMap Nominatim. Hasil disimpan di memori proses DAN dicadangkan ke file JSON (tanpa migrasi
 * database) supaya tidak hilang saat backend restart/deploy: lokasi `GEO_CACHE_FILE` (env, opsional) atau
 * `data/geo-cache.json` relatif folder kerja backend (di-git-ignore; deploy tidak menghapus file yang tak dilacak git).
 * Catatan privasi: alamat yang dikirim ke Nominatim hanya teks alamat, tanpa nama/HP pelanggan. File cache memuat teks
 * alamat + koordinat (tanpa nama/HP), dibuat dengan izin 0600; jangan menaruhnya di folder yang dilayani lewat HTTP.
 */
@Injectable()
export class JobDistanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobDistanceService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Resolved>>();
  private chain: Promise<unknown> = Promise.resolve();
  private lastNominatimAt = 0;
  private backoffUntil = 0;
  private lastHttpWarnAt = 0;
  // Persistensi cache. cacheFile null = nonaktif (mis. di tes unit, yang tidak memanggil onModuleInit).
  private cacheFile: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.cacheFile = resolve(
      process.env.GEO_CACHE_FILE || 'data/geo-cache.json',
    );
    await this.loadCache();
  }

  async onModuleDestroy() {
    await this.flushCache();
  }

  /** Muat cache dari file; entri kedaluwarsa atau bentuknya salah dibuang. File rusak/tidak ada = mulai kosong. */
  private async loadCache() {
    if (!this.cacheFile) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as {
        entries?: Record<string, { value: LatLng | null; expiresAt: number }>;
      };
      const now = Date.now();
      let loaded = 0;
      for (const [key, e] of Object.entries(raw.entries ?? {})) {
        if (typeof e?.expiresAt !== 'number' || e.expiresAt <= now) continue;
        const value =
          e.value === null
            ? null
            : validLatLng(Number(e.value?.lat), Number(e.value?.lng));
        if (e.value !== null && !value) continue;
        this.cache.set(key, { value, expiresAt: e.expiresAt });
        loaded += 1;
      }
      this.logger.log(`Cache jarak dimuat: ${loaded} alamat`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `Cache jarak tidak terbaca, mulai kosong: ${(err as Error).name}`,
        );
      }
    }
  }

  private scheduleSave() {
    if (!this.cacheFile || this.saveTimer) return;
    // Ditunda sebentar supaya banyak hasil yang selesai berdekatan ditulis sekali saja.
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushCache();
    }, 2000);
    this.saveTimer.unref();
  }

  /** Tulis cache ke file sekarang (atomik: file sementara lalu rename). Kegagalan hanya dicatat, tidak melempar. */
  async flushCache(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const file = this.cacheFile;
    if (!file) return;
    const entries = Object.fromEntries(this.cache);
    this.saving = this.saving.then(async () => {
      try {
        await fs.mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify({ version: 1, entries }), {
          mode: 0o600,
        });
        await fs.rename(tmp, file);
      } catch (err) {
        this.logger.warn(`Cache jarak gagal disimpan: ${(err as Error).name}`);
      }
    });
    return this.saving;
  }

  async distances(jobIds: string[], actor: { id: string; role: string }) {
    const ids = [...new Set(jobIds)];
    const jobs = await this.prisma.technicianJob.findMany({
      where: {
        id: { in: ids },
        ...(actor.role === 'teknisi' ? assignedTo(actor.id) : {}),
      },
      select: {
        id: true,
        workAddress: true,
        workMapsUrl: true,
        member: { select: { address: true, mapsUrl: true } },
      },
    });

    // Lokasi kerja job = titik kerja bila diisi, kalau tidak alamat/link member (sama dengan tampilan antrian).
    const targets = new Map<
      string,
      { url: string | null; text: string | null }
    >();
    const jobTarget = new Map<string, string>();
    for (const j of jobs) {
      const hasWork = !!(j.workAddress?.trim() || j.workMapsUrl?.trim());
      const url = (hasWork ? j.workMapsUrl : j.member?.mapsUrl)?.trim() || null;
      const text =
        (hasWork ? j.workAddress : j.member?.address)?.trim() || null;
      const key = `${url ?? ''}\n${text ?? ''}`;
      jobTarget.set(j.id, key);
      if (!targets.has(key)) targets.set(key, { url, text });
    }

    const deadline = Date.now() + TIME_BUDGET_MS;
    const resolved = new Map<string, Resolved>();
    // Yang sudah ada di cache dulu (instan), baru yang perlu jaringan, supaya anggaran waktu tidak habis oleh yang lambat.
    const order = [...targets.entries()].sort(
      (a, b) => Number(this.isCached(b[1])) - Number(this.isCached(a[1])),
    );
    for (const [key, t] of order)
      resolved.set(key, await this.resolve(t.url, t.text, deadline));

    const items = ids.flatMap<JobDistanceItem>((jobId) => {
      const key = jobTarget.get(jobId);
      if (key === undefined) return []; // job tidak ada / bukan milik teknisi ini
      const r = resolved.get(key)!;
      if (r.kind === 'ok') {
        return [
          {
            jobId,
            km: Math.round(haversineKm(SHOP_LOCATION, r.point) * 10) / 10,
            state: 'ok' as const,
          },
        ];
      }
      if (r.kind === 'unknown') {
        return [{ jobId, km: null, state: 'unknown', reason: r.reason }];
      }
      return [{ jobId, km: null, state: 'pending' }];
    });
    return {
      shop: SHOP_LOCATION,
      items,
      pending: items.filter((i) => i.state === 'pending').length,
    };
  }

  // ---- resolusi satu alamat ----

  private isCached(t: { url: string | null; text: string | null }): boolean {
    if (parseCoordsFromMapsUrl(t.url)) return true;
    const text = searchTextFromMapsUrl(t.url) ?? t.text;
    if (!text) return true; // tak ada yang bisa dicari = hasil (unknown) instan
    if (t.url && this.isShortLink(t.url) && this.getCache(`short:${t.url}`))
      return true;
    // Instan bila salah satu kandidat sudah ketemu, atau semua kandidat sudah pernah dicari (tidak ada yang ketemu).
    let allCached = true;
    for (const c of geocodeQueryCandidates(text)) {
      const e = this.getCache(this.geoKey(c));
      if (e?.value) return true;
      if (!e) allCached = false;
    }
    return allCached;
  }

  private async resolve(
    url: string | null,
    text: string | null,
    deadline: number,
  ): Promise<Resolved> {
    const direct = parseCoordsFromMapsUrl(url);
    if (direct) return { kind: 'ok', point: direct };

    if (url && this.isShortLink(url)) {
      const r = await this.once(`short:${url}`, () =>
        this.resolveShortLink(url, deadline),
      );
      if (r.kind !== 'unknown') return r; // ketemu atau masih pending
    }

    const query = searchTextFromMapsUrl(url) ?? text;
    if (!query) return { kind: 'unknown', reason: 'no_address' };
    // Dari yang paling spesifik ke yang makin umum; tiap kandidat punya cache sendiri, jadi pencarian yang terputus
    // (anggaran waktu habis) dilanjutkan dari kandidat berikutnya, tidak mengulang dari awal.
    for (const candidate of geocodeQueryCandidates(query)) {
      const r = await this.once(this.geoKey(candidate), () =>
        this.geocode(candidate, deadline),
      );
      if (r.kind !== 'unknown' || r.reason !== 'not_found') return r; // ketemu / pending / layanan error
    }
    return { kind: 'unknown', reason: 'not_found' };
  }

  private geoKey(text: string) {
    return `geo:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }

  private isShortLink(url: string): boolean {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || !SHORT_LINK_HOST.test(u.hostname))
        return false;
      return (
        u.hostname.toLowerCase() !== 'goo.gl' || u.pathname.startsWith('/maps')
      );
    } catch {
      return false;
    }
  }

  /** Cache + satu pekerjaan per kunci pada satu waktu (permintaan bersamaan tidak menggandakan panggilan keluar). */
  private async once(
    key: string,
    work: () => Promise<Resolved>,
  ): Promise<Resolved> {
    const hit = this.getCache(key);
    if (hit)
      return hit.value
        ? { kind: 'ok', point: hit.value }
        : { kind: 'unknown', reason: 'not_found' };
    const running = this.inflight.get(key);
    if (running) return running;
    const p = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private getCache(key: string): CacheEntry | null {
    const e = this.cache.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return e;
  }

  private setCache(key: string, value: LatLng | null) {
    if (this.cache.size >= CACHE_MAX)
      this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (value ? TTL_FOUND_MS : TTL_NOT_FOUND_MS),
    });
    this.scheduleSave();
  }

  // ---- link pendek ----

  private async resolveShortLink(
    url: string,
    deadline: number,
  ): Promise<Resolved> {
    if (Date.now() > deadline) return { kind: 'pending' };
    let current = url;
    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const res = await fetch(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': USER_AGENT },
        });
        const loc =
          res.status >= 300 && res.status < 400
            ? res.headers.get('location')
            : null;
        if (!loc) break;
        const next = new URL(loc, current);
        const hostOk =
          next.protocol === 'https:' &&
          (SHORT_LINK_HOST.test(next.hostname) ||
            GOOGLE_MAPS_HOST.test(next.hostname));
        const coords = parseCoordsFromMapsUrl(next.toString());
        if (coords) {
          this.setCache(`short:${url}`, coords);
          return { kind: 'ok', point: coords };
        }
        if (!hostOk) break;
        current = next.toString();
      }
    } catch (err) {
      this.logger.warn(`Link pendek tidak bisa dibuka: ${(err as Error).name}`);
      return { kind: 'pending' };
    }
    this.setCache(`short:${url}`, null);
    return { kind: 'unknown', reason: 'not_found' };
  }

  // ---- geocoding (Nominatim, antre 1 permintaan/detik) ----

  private async geocode(text: string, deadline: number): Promise<Resolved> {
    return this.queued(deadline, async () => {
      try {
        const qs = new URLSearchParams({
          q: text,
          format: 'jsonv2',
          limit: '1',
          countrycodes: 'id',
        });
        const res = await fetch(`${NOMINATIM_URL}?${qs.toString()}`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'id' },
        });
        if (res.status === 429 || res.status >= 500) {
          this.backoffUntil = Date.now() + BACKOFF_MS;
          this.logger.warn(
            `Nominatim membalas ${res.status}; geocoding dijeda ${BACKOFF_MS / 1000} detik`,
          );
          return { kind: 'pending' };
        }
        if (!res.ok) {
          // 400/403/dst: layanan menolak (mis. IP server diblokir). Tidak di-cache supaya dicoba lagi nanti; log dibatasi
          // satu per menit agar tidak membanjiri.
          if (Date.now() - this.lastHttpWarnAt > 60_000) {
            this.lastHttpWarnAt = Date.now();
            this.logger.warn(`Nominatim membalas ${res.status}`);
          }
          return { kind: 'unknown', reason: 'service_error' };
        }
        const rows = (await res.json()) as { lat?: string; lon?: string }[];
        const first = rows[0];
        const point = first
          ? validLatLng(Number(first.lat), Number(first.lon))
          : null;
        this.setCache(this.geoKey(text), point);
        return point
          ? { kind: 'ok', point }
          : { kind: 'unknown', reason: 'not_found' };
      } catch (err) {
        this.logger.warn(`Geocoding gagal: ${(err as Error).name}`);
        return { kind: 'pending' };
      }
    });
  }

  /** Jalankan tugas jaringan satu per satu dengan jeda minimal NOMINATIM_GAP_MS antar panggilan. */
  private queued(
    deadline: number,
    task: () => Promise<Resolved>,
  ): Promise<Resolved> {
    const run = this.chain.then(async (): Promise<Resolved> => {
      // Anggaran waktu habis / sedang dijeda: lewati TANPA menunggu jeda antar-panggilan (tidak ada panggilan keluar,
      // jadi tidak perlu jeda) dan tanpa mengubah lastNominatimAt, supaya tugas yang dilewati tidak memperlambat respons.
      const skip = () =>
        Date.now() > deadline || Date.now() < this.backoffUntil;
      if (skip()) return { kind: 'pending' };
      const wait = this.lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      if (skip()) return { kind: 'pending' };
      this.lastNominatimAt = Date.now();
      return task();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
