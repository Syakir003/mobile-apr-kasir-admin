import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Member } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: SupabaseRpcService,
  ) {}

  /** Port 1:1 dari normalize_phone() (pos_functions.sql) / phone.ts lama. */
  normalizePhone(raw: string): string {
    const cleaned = raw.replace(/[\s\-.()]/g, '');
    if (cleaned.startsWith('+62')) return cleaned;
    if (cleaned.startsWith('628')) return '+' + cleaned;
    if (cleaned.startsWith('08')) return '+62' + cleaned.substring(1);
    if (cleaned.startsWith('8')) return '+62' + cleaned;
    return cleaned;
  }

  /**
   * Sentinel unik buat member walk-in tanpa nomor HP valid — BUKAN string
   * kosong. `members.phone` di DB ternyata NOT NULL + UNIQUE beneran
   * (`members_phone_key`, dicek langsung ke Supabase, bukan partial index
   * yang ngecualiin ''), beda dari komentar lama di bawah yang assume
   * gak ada unique constraint. Walk-in KEDUA dengan HP kosong sebelumnya
   * nabrak unique violation (P2002) pas checkout — root cause, bukan
   * disimptomin per-caller, makanya fix-nya di sini (satu-satunya tempat
   * yang nulis phone kosong).
   *
   * Digit 0-9 di UUID DIGANTI (bukan di-strip) ke huruf g-p yang gak
   * dipakai di hex — keunikannya identik randomUUID(), TAPI hasilnya
   * sengaja NOL digit sehingga waPhone() (`.replace(/\D/g,'')`, lihat
   * wa-format.util.ts) balikin '' buat sentinel ini — member walk-in
   * "notelp" otomatis ke-skip dari pengiriman WA otomatis, gak ada risiko
   * nge-hit Fonnte dengan nomor ngarang.
   */
  private generateNoPhoneSentinel(): string {
    const digitToLetter = 'ghijklmnop';
    return randomUUID().replace(/[0-9]/g, (d) => digitToLetter[Number(d)]);
  }

  async findOrCreate(
    tx: Prisma.TransactionClient,
    name: string,
    rawPhone: string,
    address?: string,
  ): Promise<{ member: Member; isNew: boolean }> {
    const phone = this.normalizePhone(rawPhone);

    // phone kosong (kasir ngetik placeholder kayak "-"/"()" yang ke-strip
    // normalizePhone() jadi string kosong, tapi lolos validasi DTO checkout
    // yang cuma @IsString()) SELALU bikin member baru dengan sentinel unik
    // di atas — gak pernah di-treat sebagai kunci pencarian/reuse, biar 2
    // customer walk-in BEDA yang sama-sama gak ngasih HP gak ketuker jadi
    // 1 row Member (riwayat pembelian, totalAcUnits, unit AC servis, &
    // eligibility voucher first-purchase mereka).
    if (!phone) {
      const member = await tx.member.create({
        data: {
          name,
          phone: this.generateNoPhoneSentinel(),
          address: address ?? '',
          memberSince: new Date(),
          totalAcUnits: 0,
          active: true,
        },
      });
      return { member, isNew: true };
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;

    const existing = await tx.member.findFirst({ where: { phone } });
    if (existing) return { member: existing, isNew: false };

    const member = await tx.member.create({
      data: {
        name,
        phone,
        address: address ?? '',
        memberSince: new Date(),
        totalAcUnits: 0,
        active: true,
      },
    });
    return { member, isNew: true };
  }

  /** Cari member by nama atau nomor HP (autocomplete) — dibutuhin Siklus 6
   * biar Admin bisa nyari memberId buat POST /vouchers/campaigns/:id/offer
   * tanpa harus tau ID mentahnya. Pola sama SparepartsController.search. */
  async search(query: string) {
    const q = query.trim();
    if (!q) return [];
    return this.prisma.member.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Halaman "Member" (baru) — daftar SEMUA member (aktif maupun nonaktif,
   * beda dari search() yang cuma buat autocomplete voucher & sengaja
   * filter active:true). `q` opsional buat kotak pencarian di halaman itu.
   */
  async findAll(q?: string) {
    const query = q?.trim();
    return this.prisma.member.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { phone: { contains: query } },
            ],
          }
        : undefined,
      include: {
        _count: { select: { acUnits: true, invoices: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Detail 1 member buat halaman Member: unit-unit AC yang dia punya
   * (tiap unit nanti diklik lagi -> riwayat servisnya sendiri, lihat
   * AcUnitsService.findOne) + riwayat pembelian (invoice, sudah termasuk
   * item-itemnya — barang/jasa/sparepart, bukan cuma unit AC).
   */
  async findOne(id: string) {
    const member = await this.prisma.member.findUnique({
      where: { id },
      include: {
        acUnits: { orderBy: { createdAt: 'desc' } },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        },
      },
    });
    if (!member) throw new NotFoundException('Member tidak ditemukan');
    return member;
  }

  /**
   * Tambah member manual dari halaman "Member" (bukan lewat POS/service-
   * order intake — itu tetap lewat findOrCreate di atas). Phone kosong
   * dapet sentinel unik yang sama kayak findOrCreate; phone diisi tetap
   * wajib unik (P2002 -> 409, pola sama UsersService.create buat email).
   */
  async create(dto: { name: string; phone?: string; address?: string; customerType?: string; notes?: string }) {
    const phone = dto.phone ? this.normalizePhone(dto.phone) : '';
    try {
      return await this.prisma.member.create({
        data: {
          name: dto.name,
          phone: phone || this.generateNoPhoneSentinel(),
          address: dto.address ?? '',
          customerType: dto.customerType ?? 'lainnya',
          notes: dto.notes,
          memberSince: new Date(),
          totalAcUnits: 0,
          active: true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Nomor HP sudah dipakai member lain');
      }
      throw err;
    }
  }

  /** Edit data member — dipakai halaman "Member" (bukan wa-opt-out, itu
   * endpoint terpisah, lihat komentar setWaOptOut). */
  async update(
    id: string,
    dto: { name?: string; phone?: string; address?: string; customerType?: string; notes?: string; active?: boolean },
    actorId: string,
  ) {
    const existing = await this.prisma.member.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Member tidak ditemukan');

    const phone = dto.phone !== undefined ? this.normalizePhone(dto.phone) || this.generateNoPhoneSentinel() : undefined;
    try {
      const member = await this.prisma.member.update({
        where: { id },
        data: { ...dto, phone },
      });
      await this.prisma.auditLog.create({
        data: { actorUid: actorId, action: 'member.update', target: id, detail: { ...dto } },
      });
      return member;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Nomor HP sudah dipakai member lain');
      }
      throw err;
    }
  }

  /**
   * Pelanggan minta berhenti dikirimi pengingat WhatsApp — langsung panggil
   * RPC `set_member_wa_opt_out` (migrasi 20260815000026_reminder_rpc.sql).
   * RPC itu sendiri SUDAH mengerjakan semuanya dalam 1 transaksi Postgres:
   * update `members.wa_opt_out`, batalkan baris `wa_outbox` yang masih
   * 'pending' buat member ini ("berhenti berarti berhenti" — biar gak ada
   * pesan yang tetap terkirim setelah pelanggan minta stop), dan tulis
   * audit_logs `reminder.opt_out` sendiri — jadi TIDAK perlu diulang di sisi
   * Nest (satu implementasi, sama seperti RemindersService/WaOutboxService).
   * Invoice manual (tombol "Kirim WA") TETAP bisa dikirim kasir/admin kapan
   * pun — opt-out cuma nyetop pengingat OTOMATIS.
   */
  async setWaOptOut(id: string, optOut: boolean, actor: RpcActor) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');

    await this.rpc.call(actor, 'set_member_wa_opt_out', { memberId: id, optOut });

    return { ok: true, waOptOut: optOut };
  }
}
