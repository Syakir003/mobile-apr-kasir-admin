import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus } from '@prisma/client';
import { UNIT_PRODUCTS_SELECT } from './ac-unit-products.include';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { UpdateAcUnitDto } from './dto/update-ac-unit.dto';
import { CompleteAcUnitDataDto } from './dto/complete-ac-unit-data.dto';
import { addDays } from '../reminders/service-schedule.util';
import { resolveAcUnitPairFields, PairableProduct } from './ac-unit-pair.util';

/** Input satu unit dari Input Data Lampau (sudah divalidasi DTO). */
export interface LegacyUnitInput {
  mode: 'diketahui' | 'qr_dulu';
  brand?: string;
  model?: string;
  pk?: number;
  roomLocation?: string;
  serialNumber?: string;
  installationDate?: string;
  indoorProductId?: string;
  outdoorProductId?: string;
  lastServiceDate?: string;
  serviceIntervalDays?: number;
  reminderEnabled?: boolean;
}
import { CreateAcUnitDto } from './dto/create-ac-unit.dto';

/**
 * Port dari generate_ac_unit_barcode RPC. Format `ACUNIT-YYYYMMDD-NNNN`
 * (aturan #4 di README asli). Backend cuma nyimpen & resolve string ini —
 * gambar QR-nya di-generate di sisi Flutter/Next.js dari string barcodeValue.
 */
@Injectable()
export class AcUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  formatBarcode(date: Date, seq: number): string {
    return `ACUNIT-${this.counters.dateKey(date)}-${String(seq).padStart(4, '0')}`;
  }

  /**
   * `products`: 1 elemen (unit tunggal, atau Indoor/Outdoor dijual berdiri
   * sendiri) atau 2 elemen ([0]=Indoor, [1]=Outdoor — Point 2, mode "Unit
   * Lengkap"). SATU MemberAcUnit + SATU barcode lahir dari panggilan ini,
   * berapapun jumlah produknya — sesuai keputusan lama: 1 unit terpasang =
   * 1 barcode, walau komponennya 2 Product.
   */
  async createForInstallation(
    tx: Prisma.TransactionClient,
    memberId: string,
    products: PairableProduct[],
    roomLocation?: string,
  ) {
    const now = new Date();
    const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
    const barcodeValue = this.formatBarcode(now, seq);
    const fields = resolveAcUnitPairFields(products);

    return tx.memberAcUnit.create({
      data: {
        memberId,
        brand: fields.brand,
        model: fields.model,
        pk: fields.pk == null ? null : new Prisma.Decimal(fields.pk as any),
        roomLocation: roomLocation ?? null,
        barcodeValue,
        status: 'menunggu_pemasangan',
        indoorProductId: fields.indoorProductId,
        outdoorProductId: fields.outdoorProductId,
      },
    });
  }

  /**
   * Siklus 2 (servis masuk mandiri) — unit AC yang BELUM PERNAH tercatat di
   * sistem (customer bawa AC lama yang dibeli di tempat lain, atau dibeli di
   * toko ini sebelum sistem ini ada). Beda dari createForInstallation():
   * status langsung 'aktif' (bukan 'menunggu_pemasangan'), karena unit ini
   * sudah lama terpasang di rumah customer, bukan baru mau dipasang toko ini.
   * Tetap generate barcodeValue lewat CountersService & namespace key yang
   * SAMA (`acunit_${dateKey}`) dengan createForInstallation, jadi formatnya
   * identik dan lookupByBarcode di bawah langsung jalan tanpa modifikasi.
   */
  async registerExisting(
    tx: Prisma.TransactionClient,
    memberId: string,
    data: { brand?: string; model?: string; pk?: number; roomLocation?: string; serialNumber?: string },
  ) {
    const now = new Date();
    const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
    const barcodeValue = this.formatBarcode(now, seq);

    return tx.memberAcUnit.create({
      data: {
        memberId,
        brand: data.brand ?? null,
        model: data.model ?? null,
        pk: data.pk == null ? null : new Prisma.Decimal(data.pk),
        roomLocation: data.roomLocation ?? null,
        serialNumber: data.serialNumber ?? null,
        barcodeValue,
        status: 'aktif',
      },
    });
  }

  /**
   * Input Data Lampau (2026-10-01) — unit AC milik customer lama.
   *  - mode 'diketahui': tipe sudah diketahui -> status 'aktif'.
   *  - mode 'qr_dulu'  : tipe belum diketahui -> status 'menunggu_data',
   *    kolom tipe kosong; teknisi wajib melengkapi saat scan di lokasi.
   * Pengingat: ON hanya kalau ada siklus (7–730) dan mode 'diketahui'.
   * Barcode lewat namespace counter yang SAMA dgn createForInstallation.
   */
  async createLegacy(
    tx: Prisma.TransactionClient,
    memberId: string,
    u: LegacyUnitInput,
  ) {
    const now = new Date();
    const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
    const barcodeValue = this.formatBarcode(now, seq);

    if (u.mode === 'qr_dulu') {
      return tx.memberAcUnit.create({
        data: {
          memberId,
          roomLocation: u.roomLocation?.trim() || null,
          barcodeValue,
          status: 'menunggu_data',
          reminderEnabled: false,
        },
      });
    }

    const products: PairableProduct[] = [];
    for (const id of [u.indoorProductId, u.outdoorProductId]) {
      if (!id) continue;
      const prod = await tx.product.findUnique({ where: { id } });
      if (!prod) throw new BadRequestException('Produk AC yang dipilih tidak ditemukan');
      products.push(prod);
    }
    const fromProducts = products.length ? resolveAcUnitPairFields(products) : null;

    const brand = u.brand?.trim() || fromProducts?.brand || null;
    const model = u.model?.trim() || fromProducts?.model || null;
    const pkValue = u.pk ?? fromProducts?.pk ?? null;
    if (!brand && !model && !fromProducts) {
      throw new BadRequestException(
        'Unit dengan tipe diketahui butuh minimal merk/model atau produk AC. Kalau belum tahu, pilih mode "QR dulu".',
      );
    }

    const enabled = u.serviceIntervalDays != null && u.reminderEnabled !== false;
    if (u.reminderEnabled === true && u.serviceIntervalDays == null) {
      throw new BadRequestException('Siklus servis wajib diisi supaya pengingat bisa dinyalakan.');
    }
    const lastService = u.lastServiceDate ? new Date(u.lastServiceDate) : null;
    const nextServiceDate = enabled
      ? addDays(lastService ?? now, u.serviceIntervalDays as number)
      : null;

    return tx.memberAcUnit.create({
      data: {
        memberId,
        brand,
        model,
        pk: pkValue == null ? null : new Prisma.Decimal(pkValue as any),
        roomLocation: u.roomLocation?.trim() || null,
        serialNumber: u.serialNumber?.trim() || null,
        installationDate: u.installationDate ? new Date(u.installationDate) : null,
        lastServiceDate: lastService,
        nextServiceDate,
        serviceIntervalDays: u.serviceIntervalDays ?? null,
        reminderEnabled: enabled,
        barcodeValue,
        status: 'aktif',
        indoorProductId: fromProducts?.indoorProductId ?? null,
        outdoorProductId: fromProducts?.outdoorProductId ?? null,
      },
    });
  }

  /**
   * Endpoint kunci requirement teknisi: "scan QR/barcode — data customer &
   * unit otomatis tampil, tanpa input manual". Juga dipakai untuk validasi
   * `scannedBarcode` di TechnicianJobsService (harus cocok `unit.barcodeValue`
   * milik job yang sedang dikerjakan, sesuai gate di update_technician_job_status).
   *
   * `serviceHistory` — job-job yang SUDAH SELESAI di unit ini (terpisah dari
   * `activeJob`, yang cuma nampung 1 job yang lagi jalan/nunggu). Barcode
   * yang ditempel di unit dimaksudkan buat nyimpan histori servis, bukan
   * cuma nunjuk ke job yang aktif — teknisi/kasir yang scan barcode unit
   * lama perlu bisa liat "servis-servis sebelumnya nemu masalah apa" tanpa
   * harus buka layar lain.
   */
  async lookupByBarcode(barcodeValue: string) {
    const unit = await this.prisma.memberAcUnit.findUnique({
      where: { barcodeValue },
      include: { member: true, ...UNIT_PRODUCTS_SELECT },
    });
    if (!unit) throw new NotFoundException('Unit tidak ditemukan / QR tidak valid');
    // QR pertama kali discan = label pasti sudah menempel di unit (tracking
    // "Belum Ditempel" di Input Data Lampau). Cuma diisi sekali.
    if (!unit.labelAttachedAt) {
      const now = new Date();
      await this.prisma.memberAcUnit.updateMany({
        where: { id: unit.id, labelAttachedAt: null },
        data: { labelAttachedAt: now, ...(unit.labelPrintedAt ? {} : { labelPrintedAt: now }) },
      });
    }
    return this.buildDetail(unit);
  }

  /**
   * Teknisi/admin melengkapi unit berstatus 'menunggu_data' (QR sudah
   * ditempel tapi tipe AC belum diketahui saat input). Merk + PK wajib.
   * Pengingat tetap OFF — siklus diatur admin di Monitoring Jadwal.
   */
  async completeData(id: string, dto: CompleteAcUnitDataDto, actorId: string) {
    const unit = await this.prisma.memberAcUnit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundException('Unit AC tidak ditemukan');
    if (unit.status !== 'menunggu_data') {
      throw new BadRequestException(
        'Unit ini datanya sudah lengkap. Untuk mengubah data, ajukan koreksi ke admin.',
      );
    }
    const updated = await this.prisma.memberAcUnit.update({
      where: { id },
      data: {
        brand: dto.brand.trim(),
        model: dto.model?.trim() || null,
        pk: new Prisma.Decimal(dto.pk),
        serialNumber: dto.serialNumber?.trim() || null,
        ...(dto.roomLocation?.trim() ? { roomLocation: dto.roomLocation.trim() } : {}),
        installationDate: dto.installationDate ? new Date(dto.installationDate) : null,
        lastServiceDate: dto.lastServiceDate ? new Date(dto.lastServiceDate) : null,
        status: 'aktif',
        labelAttachedAt: unit.labelAttachedAt ?? new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'ac_unit.complete_data',
        target: id,
        detail: { brand: dto.brand, model: dto.model, pk: dto.pk },
      },
    });
    return updated;
  }

  /**
   * Sama kayak lookupByBarcode, tapi dicari pakai id (bukan scan barcode
   * fisik) — dipakai halaman web "Member" -> detail member -> klik salah
   * satu unit AC-nya -> lihat riwayat servis unit itu.
   */
  async findOne(id: string) {
    const unit = await this.prisma.memberAcUnit.findUnique({
      where: { id },
      include: { member: true, ...UNIT_PRODUCTS_SELECT },
    });
    if (!unit) throw new NotFoundException('Unit AC tidak ditemukan');
    return this.buildDetail(unit);
  }

  /**
   * Edit data unit setelah tercatat — buat betulin salah input pas
   * registrasi (kapasitas PK, lokasi ruangan, no. seri, dst) atau koreksi
   * status manual. Admin-only (sama pembatasan kayak edit master data
   * produk/sparepart/jasa lain — lihat @Roles di controller), gak
   * ada `barcodeValue`/`memberId` di DTO-nya SENGAJA — itu identitas unit,
   * bukan sesuatu yang wajar diedit lewat form biasa (pindah kepemilikan
   * unit ke member lain, kalau memang perlu, harus lewat alur terpisah).
   */
  /** POST /ac-units — unit baru di member existing (app mobile). Barcode
   * dibikin di transaksi yang sama (registerExisting), status default 'aktif'. */
  async create(dto: CreateAcUnitDto, actorId: string) {
    const member = await this.prisma.member.findUnique({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');

    const { memberId, status, ...data } = dto;
    const unit = await this.prisma.$transaction(async (tx) => {
      const created = await this.registerExisting(tx, memberId, data);
      if (!status || status === created.status) return created;
      return tx.memberAcUnit.update({ where: { id: created.id }, data: { status } });
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'ac_unit.create',
        target: unit.id,
        detail: { memberId, barcodeValue: unit.barcodeValue, status: unit.status },
      },
    });

    return unit;
  }

  async update(id: string, dto: UpdateAcUnitDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.memberAcUnit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Unit AC tidak ditemukan');

    const { installationDate, lastServiceDate, nextServiceDate, serviceIntervalDays, reminderEnabled, ...rest } = dto;

    // Pengingat servis per unit AC (2026-09-30): hitung ulang jadwal kalau
    // siklus berubah / saklar dinyalakan lagi; saklar OFF mengosongkan
    // jadwal dan membatalkan pesan pengingat yang masih antre.
    const enabledAfter = reminderEnabled ?? existing.reminderEnabled;
    const intervalAfter = serviceIntervalDays ?? existing.serviceIntervalDays;
    const turningOn = reminderEnabled === true && !existing.reminderEnabled;
    const intervalChanged =
      serviceIntervalDays !== undefined && serviceIntervalDays !== existing.serviceIntervalDays;
    const turningOff = reminderEnabled === false && existing.reminderEnabled;

    let computedNext: Date | null | undefined;
    if (!enabledAfter) {
      if (reminderEnabled === false) computedNext = null;
    } else if (turningOn || intervalChanged) {
      if (intervalAfter === null || intervalAfter === undefined) {
        throw new BadRequestException(
          'Siklus servis wajib diisi (dalam hari) supaya pengingat bisa dinyalakan.',
        );
      }
      const base = turningOn ? new Date() : (existing.lastServiceDate ?? new Date());
      computedNext = addDays(base, intervalAfter);
    }

    const unit = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.memberAcUnit.update({
        where: { id },
        data: {
          ...rest,
          ...(serviceIntervalDays !== undefined ? { serviceIntervalDays } : {}),
          ...(reminderEnabled !== undefined ? { reminderEnabled } : {}),
          ...(installationDate !== undefined ? { installationDate: new Date(installationDate) } : {}),
          ...(lastServiceDate !== undefined ? { lastServiceDate: new Date(lastServiceDate) } : {}),
          // Tanggal yang diisi manual admin menang atas hitungan otomatis.
          ...(nextServiceDate !== undefined
            ? { nextServiceDate: new Date(nextServiceDate) }
            : computedNext !== undefined
              ? { nextServiceDate: computedNext }
              : {}),
        },
      });
      if (turningOff) {
        await tx.whatsappLog.updateMany({
          where: {
            status: 'pending',
            kind: { in: ['selesai_servis', 'reminder_h3', 'reminder_h7'] },
            unitIds: { has: id },
          },
          data: { status: 'dibatalkan', error: 'Pengingat unit dimatikan' },
        });
      }
      return updated;
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'ac_unit.update',
        target: id,
        detail: { ...dto },
      },
    });

    return unit;
  }

  private async buildDetail(
    unit: Prisma.MemberAcUnitGetPayload<{ include: { member: true } & typeof UNIT_PRODUCTS_SELECT }>,
  ) {
    const activeJob = await this.prisma.technicianJob.findFirst({
      where: {
        unitId: unit.id,
        status: { notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const serviceHistory = await this.prisma.technicianJob.findMany({
      where: { unitId: unit.id, status: TechnicianJobStatus.selesai },
      include: {
        technician: { select: { id: true, displayName: true } },
        findings: {
          select: { id: true, title: true, note: true, origin: true },
        },
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });

    return { unit, member: unit.member, activeJob, serviceHistory };
  }
}
