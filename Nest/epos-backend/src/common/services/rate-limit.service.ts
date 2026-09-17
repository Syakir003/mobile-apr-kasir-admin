import { Injectable } from '@nestjs/common';

/**
 * Penghitung sliding-window IN-MEMORY sederhana, dipakai bareng buat semua
 * endpoint yang perlu direm (login, ganti password). SENGAJA gak nambah
 * dependency (@nestjs/throttler dkk) — lihat catatan di LoginThrottleGuard
 * soal kenapa.
 *
 * BATASNYA (sadar, bukan kelupaan): state-nya per-proses. Kalau backend
 * di-scale ke >1 instance, tiap instance punya hitungan sendiri, jadi batas
 * efektifnya jadi N kali lipat. Buat skala 1 toko / 1 instance ini cukup —
 * dan ini lapisan mitigasi, bukan satu-satunya pertahanan (bcrypt + policy
 * password tetap jalan independen). Kalau nanti beneran multi-instance,
 * tinggal ganti isi kelas ini ke Redis tanpa nyentuh pemanggilnya.
 */
@Injectable()
export class RateLimitService {
  private readonly hits = new Map<string, number[]>();

  /**
   * Catat satu percobaan buat `key`. Balikin `false` kalau udah lewat batas
   * (pemanggil yang mutusin mau throw apa) — percobaan yang ditolak TIDAK
   * ikut dicatat, biar jendelanya bisa habis sendiri, bukan kepanjangan
   * gara-gara si penyerang terus ngetok.
   */
  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Hapus jendela buat `key` — dipanggil pas percobaan BERHASIL, biar user
   * yang cuma salah ketik beberapa kali lalu berhasil login gak kebawa sisa
   * hitungan ke percobaan berikutnya. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Beberes entri mati biar Map-nya gak numpuk selamanya. Nebeng dipanggil
   * dari guard tiap request (skala 1 toko, gak perlu setInterval sendiri). */
  sweep(windowMs: number, threshold = 10_000): void {
    if (this.hits.size <= threshold) return;
    const now = Date.now();
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= windowMs)) this.hits.delete(key);
    }
  }
}
