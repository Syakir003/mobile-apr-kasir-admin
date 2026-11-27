import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Member, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MemberListQueryDto } from './dto/member-list-query.dto';
import { CreateMemberLocationDto, MoveUnitsLocationDto, UpdateMemberLocationDto } from './dto/member-location.dto';
import { UNIT_PRODUCTS_SELECT } from '../ac-units/ac-unit-products.include';
import type { PriceTierName } from '../common/price-tier.util';
import { normalizePhone } from '../common/phone.util';
import { mainLocationName, resolveLocationChoice } from '../common/member-location.util';
import { assertNoActiveJob } from '../technician-jobs/active-job.util';

/** Batas lokasi TAMBAHAN per member (Lokasi 1 tidak dihitung). */
const MAX_EXTRA_LOCATIONS = 20;

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normalisasi nomor HP (kunci pencarian member); aturannya di common/phone.util.ts. */
  normalizePhone(raw: string): string {
    return normalizePhone(raw);
  }

  async findOrCreate(
    tx: Prisma.TransactionClient,
    name: string,
    rawPhone: string,
    address?: string,
    // Tipe pembeli buat member BARU saja (2026-10-13). Member yang sudah ada
    // (ketemu lewat nomor HP) TIDAK diubah tipenya dari sini.
    priceTier: PriceTierName = 'retail',
    mapsUrl?: string,
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
          mapsUrl: mapsUrl ?? null,
          priceTier,
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
        mapsUrl: mapsUrl ?? null,
        priceTier,
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
          mapsUrl: dto.mapsUrl ?? null,
          customerType: dto.customerType ?? null,
          notes: dto.notes ?? null,
          priceTier: dto.priceTier ?? 'retail',
          multiLocation: dto.multiLocation ?? false,
          // Nama Lokasi 1 hanya bermakna kalau multi lokasi menyala.
          mainLocationName: dto.multiLocation ? dto.mainLocationName?.trim() || null : null,
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
          detail: {
            name: member.name,
            phone: member.phone || null,
            priceTier: member.priceTier,
            ...(member.multiLocation ? { multiLocation: true } : {}),
          },
        },
      });

      return { status: 'ok' as const, member };
    });
  }

  /** Edit data member. Nomor HP dinormalisasi sama seperti saat buat. */
  async update(id: string, dto: UpdateMemberDto, actorId: string) {
    const existing = await this.prisma.member.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Member tidak ditemukan');

    const { phone, mainLocationName: mainName, ...rest } = dto;
    // Multi lokasi tidak boleh dimatikan selama masih ada unit di lokasi tambahan: unit itu akan "kehilangan" lokasinya
    // dan tercampur ke Lokasi 1. Admin memindahkannya dulu (Pindahkan ke lokasi di halaman member).
    if (dto.multiLocation === false && existing.multiLocation) {
      const inOtherLocations = await this.prisma.memberAcUnit.count({
        where: { memberId: id, locationId: { not: null } },
      });
      if (inOtherLocations > 0) {
        throw new BadRequestException(
          `Multi lokasi belum bisa dimatikan: masih ada ${inOtherLocations} unit AC di lokasi selain "${mainLocationName(existing)}". ` +
            'Pindahkan unit-unit itu ke Lokasi 1 dulu.',
        );
      }
    }
    const member = await this.prisma.member.update({
      where: { id },
      data: {
        ...rest,
        ...(phone !== undefined ? { phone: this.normalizePhone(phone) } : {}),
        ...(mainName !== undefined ? { mainLocationName: mainName?.trim() || null } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'member.update', target: id, detail: { fields: Object.keys(dto) } },
    });
    return member;
  }

  /** Cari member by nama atau nomor HP (autocomplete) — dibutuhin Siklus 6
   * biar Admin bisa nyari memberId buat POST /vouchers/campaigns/:id/offer
   * tanpa harus tau ID mentahnya. Pola sama SparepartsController.search. */
  async search(query: string) {
    const q = query.trim();
    // Tanpa kata kunci = daftar awal (20 member pertama A-Z) buat dropdown
    // pilih member di POS/servis mandiri; ketik buat mempersempit.
    return this.prisma.member.findMany({
      where: {
        active: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
              ],
            }
          : {}),
      },
      take: 20,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Halaman "Member" (baru) — daftar SEMUA member (aktif maupun nonaktif,
   * beda dari search() yang cuma buat autocomplete voucher & sengaja
   * filter active:true). `q` opsional buat kotak pencarian di halaman itu.
   */
  async findAll(params: MemberListQueryDto) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const query = params.q?.trim();
    const where: Prisma.MemberWhereInput | undefined = query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query } },
          ],
        }
      : undefined;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.member.findMany({
        where,
        include: { _count: { select: { acUnits: true, invoices: true } } },
        // id sebagai pembeda urutan supaya nama kembar tidak loncat antar halaman.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.member.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
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
        // Lokasi TAMBAHAN (Lokasi 1 = alamat utama member, bukan baris di sini); kosong bila multi lokasi belum dipakai.
        locations: { orderBy: { createdAt: 'asc' } },
        acUnits: {
          orderBy: { createdAt: "desc" },
          include: {
            ...UNIT_PRODUCTS_SELECT,
            location: { select: { id: true, name: true } },
            // Job yang belum final pada unit ini (maks. 1): form intake menandai unit yang masih dikerjakan,
            // karena unit dengan job aktif tidak boleh dibuatkan job servis baru.
            technicianJobs: {
              where: { status: { notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan] } },
              select: { id: true, status: true },
              take: 1,
            },
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          // buyPriceSnapshot = harga modal, jangan sampai kebaca kasir.
          include: { items: { omit: { buyPriceSnapshot: true } } },
        },
      },
    });
    if (!member) throw new NotFoundException('Member tidak ditemukan');
    return member;
  }

  // ---------------------------------------------------------------- multi lokasi

  private async getMultiLocationMember(db: Pick<Prisma.TransactionClient, 'member'>, id: string) {
    const member = await db.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');
    if (!member.multiLocation) {
      throw new BadRequestException('Aktifkan multi lokasi di data member dulu');
    }
    return member;
  }

  /** Tambah lokasi tambahan (Lokasi 2, 3, ...). Wajib punya alamat atau link Maps supaya bisa dipakai sebagai lokasi kerja. */
  async addLocation(memberId: string, dto: CreateMemberLocationDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await this.getMultiLocationMember(tx, memberId);
      const name = dto.name.trim();
      const address = dto.address?.trim() || null;
      const mapsUrl = dto.mapsUrl?.trim() || null;
      if (!name) throw new BadRequestException('Nama lokasi wajib diisi');
      if (!address && !mapsUrl) throw new BadRequestException('Isi alamat atau link Maps lokasi ini');
      const existing = await tx.memberLocation.findMany({ where: { memberId }, select: { name: true } });
      if (existing.length >= MAX_EXTRA_LOCATIONS) {
        throw new BadRequestException(`Maksimal ${MAX_EXTRA_LOCATIONS} lokasi tambahan per member`);
      }
      this.assertLocationNameFree(name, member, existing.map((l) => l.name));
      const location = await tx.memberLocation.create({ data: { memberId, name, address, mapsUrl } });
      await tx.auditLog.create({
        data: { actorUid: actorId, action: 'member.location_add', target: memberId, detail: { locationId: location.id, name } },
      });
      return location;
    });
  }

  async updateLocation(memberId: string, locationId: string, dto: UpdateMemberLocationDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await this.getMultiLocationMember(tx, memberId);
      const current = await tx.memberLocation.findFirst({ where: { id: locationId, memberId } });
      if (!current) throw new NotFoundException('Lokasi tidak ditemukan');
      const name = dto.name !== undefined ? dto.name.trim() : current.name;
      const address = dto.address !== undefined ? dto.address?.trim() || null : current.address;
      const mapsUrl = dto.mapsUrl !== undefined ? dto.mapsUrl?.trim() || null : current.mapsUrl;
      if (!name) throw new BadRequestException('Nama lokasi wajib diisi');
      if (!address && !mapsUrl) throw new BadRequestException('Isi alamat atau link Maps lokasi ini');
      if (name !== current.name) {
        const others = await tx.memberLocation.findMany({
          where: { memberId, id: { not: locationId } },
          select: { name: true },
        });
        this.assertLocationNameFree(name, member, others.map((l) => l.name));
      }
      const location = await tx.memberLocation.update({ where: { id: locationId }, data: { name, address, mapsUrl } });
      await tx.auditLog.create({
        data: { actorUid: actorId, action: 'member.location_update', target: memberId, detail: { locationId, name } },
      });
      return location;
    });
  }

  /** Hapus lokasi tambahan; ditolak selama masih dipakai unit atau order (riwayat tidak boleh kehilangan lokasinya). */
  async removeLocation(memberId: string, locationId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.memberLocation.findFirst({ where: { id: locationId, memberId } });
      if (!location) throw new NotFoundException('Lokasi tidak ditemukan');
      const [units, orders] = await Promise.all([
        tx.memberAcUnit.count({ where: { locationId } }),
        tx.serviceOrder.count({ where: { locationId } }),
      ]);
      if (units > 0) {
        throw new BadRequestException(
          `Lokasi "${location.name}" masih dipakai ${units} unit AC. Pindahkan unit-unitnya ke lokasi lain dulu.`,
        );
      }
      if (orders > 0) {
        throw new BadRequestException(
          `Lokasi "${location.name}" sudah dipakai ${orders} order servis, jadi tidak bisa dihapus (riwayat order butuh lokasinya).`,
        );
      }
      await tx.memberLocation.delete({ where: { id: locationId } });
      await tx.auditLog.create({
        data: { actorUid: actorId, action: 'member.location_remove', target: memberId, detail: { locationId, name: location.name } },
      });
      return { ok: true };
    });
  }

  /**
   * Pindahkan beberapa unit AC milik member ke satu lokasi sekaligus ('utama' = Lokasi 1). Unit yang sedang punya job
   * aktif tidak dipindah: job itu berjalan di lokasi order yang lama.
   */
  async moveUnitsToLocation(memberId: string, dto: MoveUnitsLocationDto, actorId: string) {
    const unitIds = [...new Set(dto.unitIds)];
    return this.prisma.$transaction(async (tx) => {
      const member = await this.getMultiLocationMember(tx, memberId);
      const target = await resolveLocationChoice(tx, member, dto.locationId);
      const units = await tx.memberAcUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, memberId: true } });
      if (units.length !== unitIds.length || units.some((u) => u.memberId !== memberId)) {
        throw new BadRequestException('Ada unit yang tidak ditemukan atau bukan milik member ini');
      }
      await assertNoActiveJob(tx, unitIds);
      const res = await tx.memberAcUnit.updateMany({ where: { id: { in: unitIds } }, data: { locationId: target.locationId } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'member.units_move_location',
          target: memberId,
          detail: { unitIds, locationId: target.locationId, locationName: target.name },
        },
      });
      return { ok: true, moved: res.count, locationId: target.locationId, locationName: target.name };
    });
  }

  private assertLocationNameFree(name: string, member: { mainLocationName: string | null }, others: string[]) {
    const wanted = name.toLowerCase();
    if (mainLocationName(member).toLowerCase() === wanted || others.some((n) => n.toLowerCase() === wanted)) {
      throw new BadRequestException(`Nama lokasi "${name}" sudah dipakai member ini`);
    }
  }

  /**
   * Pelanggan minta berhenti dikirimi pengingat WhatsApp — port dari RPC
   * set_member_wa_opt_out (migrasi Supabase 0026). "Berhenti berarti
   * berhenti": pesan reminder yang masih 'pending' ikut dibatalkan biar
   * gak ada yang tetap terkirim setelah pelanggan minta stop. Invoice
   * manual (tombol "Kirim WA") TETAP bisa dikirim kasir/admin kapan pun —
   * opt-out cuma nyetop pengingat OTOMATIS, sama persis semantik aslinya.
   */
  /** Ubah tipe pembeli member (admin) — menentukan harga & hak beli di POS.
   * Invoice lama tidak berubah (tipe di-snapshot per invoice). */
  async setPriceTier(id: string, priceTier: PriceTierName, actorId: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');
    if (member.priceTier === priceTier) return { ok: true, priceTier };

    await this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id }, data: { priceTier } });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'member.set_price_tier',
          target: id,
          detail: { name: member.name, from: member.priceTier, to: priceTier },
        },
      });
    });
    return { ok: true, priceTier };
  }

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
