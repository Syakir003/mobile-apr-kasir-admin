import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Member } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Port 1:1 dari normalize_phone() (pos_functions.sql) / phone.ts lama. */
  normalizePhone(raw: string): string {
    const cleaned = raw.replace(/[\s\-.()]/g, '');
    if (cleaned.startsWith('+62')) return cleaned;
    if (cleaned.startsWith('628')) return '+' + cleaned;
    if (cleaned.startsWith('08')) return '+62' + cleaned.substring(1);
    if (cleaned.startsWith('8')) return '+62' + cleaned;
    return cleaned;
  }

  async findOrCreate(
    tx: Prisma.TransactionClient,
    name: string,
    rawPhone: string,
    address?: string,
  ): Promise<{ member: Member; isNew: boolean }> {
    const phone = this.normalizePhone(rawPhone);

    // `phone` gak punya @unique constraint di schema (ganti-nambah unique
    // index di kolom yang mungkin udah ada data duplikat di produksi itu
    // migration yang riskan — lihat insiden drift voucher_campaigns). Jadi
    // race-nya ditutup pakai Postgres advisory lock yang di-scope ke
    // transaction ini (pg_advisory_xact_lock, auto-release pas commit/
    // rollback): 2 checkout bareng buat nomor HP yang sama bakal ANTRE di
    // sini, bukan dua-duanya lolos findFirst dan bikin 2 row Member.
    //
    // Fix dari audit: `if (phone)` di atas SENGAJA skip lock+lookup kalau
    // phone kosong — tapi sebelumnya kode di bawah (findFirst+reuse) tetap
    // jalan buat phone==='' juga, jadi 2 customer WALK-IN BEDA yang
    // sama-sama gak punya HP (kasir ngetik placeholder kayak "-"/"()" yang
    // ke-strip normalizePhone() jadi string kosong, tapi lolos @IsNotEmpty
    // di DTO) malah ke-REUSE jadi 1 row Member yang SAMA — riwayat
    // pembelian, totalAcUnits, unit AC servis, & eligibility voucher
    // first-purchase mereka ketuker/tercampur. phone kosong sekarang
    // SELALU bikin member baru, gak pernah di-treat sebagai kunci pencarian.
    if (!phone) {
      const member = await tx.member.create({
        data: {
          name,
          phone,
          address: address ?? null,
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
        address: address ?? null,
        memberSince: new Date(),
        totalAcUnits: 0,
        active: true,
      },
    });
    return { member, isNew: true };
  }

  /**
   * Tambah member manual (halaman "Member", tombol "Tambah Member") — beda
   * dari findOrCreate() yang dipanggil checkout POS/servis: di sini gak ada
   * transaksi yang nyertain, admin/kasir emang niat daftarin pelanggan
   * duluan (mis. member baru yang belum pernah beli apa-apa).
   *
   * Pola "soft-warn + confirm" sama kayak StockService.stockIn(): kalau
   * nomor HP udah kepake member lain DAN `confirmOverride` belum true,
   * balikin `{status:'confirm_required', existingMember}` (HTTP 200,
   * BUKAN error) biar FE bisa nampilin dialog "tetap lanjut / ganti
   * nomor". Advisory lock (pg_advisory_xact_lock) sama persis kayak
   * findOrCreate() — nyegah 2 submit bareng nomor HP yang sama lolos
   * dua-duanya jadi 2 row.
   */
  async create(dto: CreateMemberDto, actorId: string) {
    const phone = dto.phone ? this.normalizePhone(dto.phone) : '';

    return this.prisma.$transaction(async (tx) => {
      if (phone) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;

        if (!dto.confirmOverride) {
          const existing = await tx.member.findFirst({ where: { phone } });
          if (existing) {
            return {
              status: 'confirm_required' as const,
              existingMember: { id: existing.id, name: existing.name, phone: existing.phone },
            };
          }
        }
      }

      const member = await tx.member.create({
        data: {
          name: dto.name,
          phone,
          address: dto.address ?? null,
          customerType: dto.customerType ?? null,
          memberSince: new Date(),
          totalAcUnits: 0,
          active: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'member.create_manual',
          target: member.id,
          detail: { name: member.name, phone: member.phone || null },
        },
      });

      return { status: 'ok' as const, member };
    });
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
   * Pelanggan minta berhenti dikirimi pengingat WhatsApp — port dari RPC
   * set_member_wa_opt_out (migrasi Supabase 0026). "Berhenti berarti
   * berhenti": pesan reminder yang masih 'pending' ikut dibatalkan biar
   * gak ada yang tetap terkirim setelah pelanggan minta stop. Invoice
   * manual (tombol "Kirim WA") TETAP bisa dikirim kasir/admin kapan pun —
   * opt-out cuma nyetop pengingat OTOMATIS, sama persis semantik aslinya.
   */
  async setWaOptOut(id: string, optOut: boolean, actorId: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');

    await this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id }, data: { waOptOut: optOut } });
      if (optOut) {
        await tx.whatsappLog.updateMany({
          where: {
            memberId: id,
            status: 'pending',
            kind: { in: ['selesai_servis', 'reminder_h3', 'reminder_h7'] },
          },
          data: { status: 'dibatalkan', error: 'Pelanggan opt-out' },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'reminder.opt_out',
          target: id,
          detail: { optOut },
        },
      });
    });

    return { ok: true, waOptOut: optOut };
  }
}
