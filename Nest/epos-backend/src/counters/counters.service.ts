import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { wibDateKey } from '../common/wib-date.util';

/**
 * Pengganti tabel `counters` + `INSERT ... ON CONFLICT (key) DO UPDATE SET
 * seq = counters.seq + 1 RETURNING seq` yang dipakai di seluruh RPC asli
 * (invoice number, barcode unit AC). `ON CONFLICT DO UPDATE` sudah row-locking
 * implisit dalam satu round-trip — TIDAK perlu `SELECT ... FOR UPDATE` manual.
 * WAJIB dipanggil di dalam `tx` yang sama dengan transaksi pemanggil, supaya
 * ikut rollback kalau ada error setelahnya (nomor gak "bolong").
 */
@Injectable()
export class CountersService {
  async nextSeq(tx: Prisma.TransactionClient, key: string): Promise<number> {
    const rows = await tx.$queryRaw<{ seq: number }[]>`
      INSERT INTO counters (key, seq) VALUES (${key}, 1)
      ON CONFLICT (key) DO UPDATE SET seq = counters.seq + 1
      RETURNING seq;
    `;
    return rows[0].seq;
  }

  /**
   * Fix dari audit: sebelumnya pakai getFullYear()/getMonth()/getDate() —
   * itu baca komponen tanggal dalam TIMEZONE LOKAL PROSES NODE, bukan WIB.
   * Kalau server production di-deploy TZ=UTC (umum), transaksi jam
   * 00:00–06:59 WIB dapet dateKey hari SEBELUMNYA (nomor invoice salah
   * tanggal, dan seq hariannya nyambung ke counter hari kemarin, bukan reset
   * ke 0001). Sekarang pakai wibDateKey() (Intl.DateTimeFormat timeZone
   * eksplisit Asia/Jakarta), sama pola kayak reports.util.ts.
   */
  dateKey(date: Date): string {
    return wibDateKey(date);
  }
}
