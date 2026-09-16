import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Toko WIB (UTC+7). Kalau admin cuma kirim tanggal polos ("2026-09-20" dari
 * date-picker), dipaksa jadi akhir hari WIB — sama pola kayak
 * VoucherCampaign lama (startOfDayWIB/endOfDayWIB), cuma di sini cuma butuh
 * "akhir hari" (expiresAt), gak ada "awal hari" karena voucher gak punya
 * tanggal mulai. */
function endOfDayWIB(dateStr: string): Date {
  return DATE_ONLY.test(dateStr)
    ? new Date(`${dateStr}T23:59:59.999+07:00`)
    : new Date(dateStr);
}

// Tanpa 0/O/1/I biar gak ambigu dibaca/diketik manual oleh kasir — port 1:1
// dari generate_voucher_code() di Supabase (backend/supabase/migrations/
// 20260817000027_voucher_undian_schema.sql).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomVoucherCode(): string {
  let code = 'VCR-';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/**
 * Rework total (2026-09) — sebelumnya modul ini implementasi VoucherCampaign
 * + VoucherClaim (campaign ditawarkan ke BANYAK member sekaligus, tiap
 * member "klaim" dulu sebelum bisa dipakai). Itu SALAH konsep: voucher di
 * app mobile itu ad-hoc, satu kode = satu member, dibuat langsung oleh admin
 * (bukan broadcast campaign), dan dipakai kasir cuma dengan ketik kodenya
 * saat checkout — TIDAK ada langkah "klaim" terpisah. Direkonstruksi 1:1
 * dari backend/supabase/migrations/20260817000027_voucher_undian_schema.sql,
 * 20260817000029_voucher_rpc.sql, dan 20260817000030_checkout_voucher.sql.
 *
 * Bagian intinya (lockAndValidateCode) dipanggil dari PosService.checkout()
 * di dalam transaction checkout yang sama, supaya 1 voucher gak bisa kepake
 * 2x kalau ada 2 device checkout barengan.
 */
@Injectable()
export class VouchersService {
  constructor(private readonly prisma: PrismaService) {}

  async createVoucher(dto: CreateVoucherDto, actorId: string) {
    const member = await this.prisma.member.findUnique({ where: { id: dto.memberId } });
    if (!member || !member.active) {
      throw new BadRequestException('Pelanggan tidak ditemukan atau tidak aktif');
    }
    if (dto.discountType === 'persen' && dto.discountValue > 100) {
      throw new BadRequestException('Diskon persen maksimal 100');
    }
    const expiresAt = endOfDayWIB(dto.expiresAt);
    if (expiresAt < new Date()) {
      throw new BadRequestException('Tanggal kedaluwarsa harus di masa depan');
    }

    // Retry kalau kebetulan tabrakan kode (ruang praktis 33^6, tabrakan
    // nyaris mustahil, tapi tetap dijaga — sama kayak versi SQL-nya).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomVoucherCode();
      try {
        const voucher = await this.prisma.voucher.create({
          data: {
            code,
            memberId: dto.memberId,
            discountType: dto.discountType,
            discountValue: dto.discountValue,
            maxDiscountCap: dto.maxDiscountCap,
            minPurchase: dto.minPurchase,
            expiresAt,
            status: 'aktif',
            source: 'manual',
            note: dto.note?.trim() || null,
            createdById: actorId,
          },
        });
        await this.prisma.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'voucher.create',
            target: voucher.id,
            detail: { code: voucher.code, memberId: dto.memberId },
          },
        });
        return voucher;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue; // kode tabrakan, coba lagi dengan kode baru
        }
        throw err;
      }
    }
    throw new BadRequestException('Gagal membuat kode voucher unik, coba lagi');
  }

  /** Batalkan voucher yang masih aktif. Voucher yang sudah terpakai/
   * kedaluwarsa/dibatalkan gak bisa dibatalkan lagi (sama kayak RPC
   * cancel_voucher — `WHERE status = 'aktif'`). */
  async cancelVoucher(voucherId: string, reason: string | undefined, actorId: string) {
    const result = await this.prisma.voucher.updateMany({
      where: { id: voucherId, status: 'aktif' },
      data: { status: 'dibatalkan' },
    });
    if (result.count === 0) {
      throw new NotFoundException('Voucher tidak ditemukan atau sudah tidak aktif');
    }
    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'voucher.cancel',
        target: voucherId,
        detail: { reason: reason?.trim() || null },
      },
    });
    return { ok: true };
  }

  /** Semua voucher, terbaru dulu — padanan `vouchersStreamProvider` di
   * mobile ("Semua voucher, terbaru dulu"). Admin & kasir boleh lihat. */
  async findAll() {
    return this.prisma.voucher.findMany({
      orderBy: { createdAt: 'desc' },
      include: { member: { select: { id: true, name: true, phone: true } } },
    });
  }

  /**
   * Dipanggil dari PosService.checkout() DI DALAM transaction checkout yang
   * sama. Lock baris voucher (`FOR UPDATE`), validasi PERSIS urutan yang
   * sama kayak checkout_transaction RPC — kode ditemukan, status aktif,
   * belum kedaluwarsa, cocok member transaksi ini, subtotal >= minPurchase —
   * lalu hitung nominal potongannya. TIDAK melakukan write/status-update di
   * sini (itu tanggung jawab PosService setelah invoice ke-generate, karena
   * butuh invoiceId buat `usedInInvoiceId`).
   *
   * @param subtotal subtotal mentah keranjang (qty*harga item, SEBELUM
   *   diskon ad-hoc/transaksi dikurangkan) — basis cek minPurchase & hitung
   *   persen, sama kayak `v_subtotal` di checkout_transaction RPC.
   */
  async lockAndValidateCode(
    tx: Prisma.TransactionClient,
    codeRaw: string,
    memberId: string,
    subtotal: number,
  ): Promise<{ voucherId: string; discountAmount: number }> {
    const code = codeRaw.trim().toUpperCase();
    // SELECT ... FOR UPDATE — kunci baris ini sampai transaksi checkout
    // commit/rollback, biar checkout lain yang coba pakai kode yang SAMA
    // harus nunggu (bukan baca status basi).
    const rows = await tx.$queryRaw<
      {
        id: string;
        member_id: string;
        discount_type: string;
        discount_value: Prisma.Decimal;
        max_discount_cap: Prisma.Decimal | null;
        min_purchase: Prisma.Decimal | null;
        expires_at: Date;
        status: string;
      }[]
    >`SELECT * FROM vouchers WHERE code = ${code} FOR UPDATE`;
    const voucher = rows[0];
    if (!voucher) throw new BadRequestException('Kode voucher tidak ditemukan');
    if (voucher.status !== 'aktif') {
      throw new BadRequestException(`Voucher ini sudah ${voucher.status}`);
    }
    if (new Date(voucher.expires_at) < new Date()) {
      throw new BadRequestException('Voucher ini sudah kedaluwarsa');
    }
    if (voucher.member_id !== memberId) {
      throw new BadRequestException('Kode voucher ini bukan milik pelanggan ini');
    }
    const minPurchase = voucher.min_purchase ? Number(voucher.min_purchase) : null;
    if (minPurchase !== null && subtotal < minPurchase) {
      throw new BadRequestException(
        `Belanja belum mencapai minimal Rp ${minPurchase.toLocaleString('id-ID')} untuk voucher ini`,
      );
    }

    const value = Number(voucher.discount_value);
    const cap = voucher.max_discount_cap ? Number(voucher.max_discount_cap) : null;
    const discountAmount =
      voucher.discount_type === 'nominal'
        ? value
        : Math.min(Math.round((subtotal * value) / 100), cap ?? subtotal);

    return { voucherId: voucher.id, discountAmount };
  }
}
