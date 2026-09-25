import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcUnitStatus, Prisma } from '@prisma/client';
import { TechnicianJobStatus } from '../common/technician-job-status';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { UpdateAcUnitDto } from './dto/update-ac-unit.dto';

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

  async createForInstallation(
    tx: Prisma.TransactionClient,
    memberId: string,
    product: { brand?: string | null; type?: string | null; pk?: Prisma.Decimal | number | null },
    roomLocation?: string,
  ) {
    const now = new Date();
    const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
    const barcodeValue = this.formatBarcode(now, seq);

    return tx.memberAcUnit.create({
      data: {
        memberId,
        // brand/model String WAJIB (gak ada @default di schema) — '' bukan
        // null buat yang gak keisi. pk/roomLocation ADA @default DB (0/''),
        // jadi undefined (field diomit) yang benar, bukan null.
        brand: product.brand ?? '',
        model: product.type ?? '',
        pk: product.pk == null ? undefined : new Prisma.Decimal(product.pk as any),
        roomLocation: roomLocation ?? undefined,
        barcodeValue,
        status: 'menunggu_pemasangan',
      },
    });
  }

  /**
   * Siklus 2 (servis masuk mandiri) — unit AC yang BELUM PERNAH tercatat di
   * sistem (customer bawa AC lama yang dibeli di tempat lain, atau dibeli di
   * toko ini sebelum sistem ini ada). Beda dari createForInstallation():
   * status default 'aktif' (bukan 'menunggu_pemasangan'), karena unit ini
   * sudah lama terpasang di rumah customer, bukan baru mau dipasang toko ini.
   * Tetap generate barcodeValue lewat CountersService & namespace key yang
   * SAMA (`acunit_${dateKey}`) dengan createForInstallation, jadi formatnya
   * identik dan lookupByBarcode di bawah langsung jalan tanpa modifikasi.
   *
   * `data.status`/`opts.generateBarcode` OPSIONAL, khusus dipakai create()
   * di bawah (endpoint mobile) — ServiceOrdersService.intake() (dipakai web)
   * TIDAK PERNAH mengirim keduanya, jadi perilakunya PERSIS SAMA seperti
   * sebelumnya: status selalu 'aktif', barcode selalu digenerate di sini.
   */
  async registerExisting(
    tx: Prisma.TransactionClient,
    memberId: string,
    data: {
      brand?: string;
      model?: string;
      pk?: number;
      roomLocation?: string;
      serialNumber?: string;
      status?: AcUnitStatus;
    },
    opts?: { generateBarcode?: boolean },
  ) {
    let barcodeValue: string | undefined;
    if (opts?.generateBarcode ?? true) {
      const now = new Date();
      const seq = await this.counters.nextSeq(tx, `acunit_${this.counters.dateKey(now)}`);
      barcodeValue = this.formatBarcode(now, seq);
    }

    return tx.memberAcUnit.create({
      data: {
        memberId,
        brand: data.brand ?? '',
        model: data.model ?? '',
        pk: data.pk == null ? undefined : new Prisma.Decimal(data.pk),
        roomLocation: data.roomLocation ?? undefined,
        serialNumber: data.serialNumber ?? null,
        barcodeValue,
        status: data.status ?? 'aktif',
      },
    });
  }

  /**
   * Wrapper publik registerExisting() buat endpoint standalone "tambah unit
   * AC" (halaman Member -> detail member -> tambah unit, form mobile) —
   * registerExisting sendiri butuh `tx` external karena sebelumnya cuma
   * dipanggil dari dalam transaksi ServiceOrdersService.intake. Di sini
   * transaksinya dibuka sendiri + audit log, pola sama kayak update() di bawah.
   *
   * Barcode SENGAJA tidak digenerate di sini (`generateBarcode: false`) —
   * alur form mobile (`unit_form_screen.dart._submit`) selalu manggil RPC
   * `generate_ac_unit_barcode` sendiri persis sesudah create() sukses, dan
   * RPC itu menolak generate ulang kalau unit sudah punya barcodeValue.
   */
  async create(
    memberId: string,
    data: {
      brand?: string;
      model?: string;
      pk?: number;
      roomLocation?: string;
      serialNumber?: string;
      status?: AcUnitStatus;
    },
    actorId: string,
  ) {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');

    const unit = await this.prisma.$transaction((tx) =>
      this.registerExisting(tx, memberId, data, { generateBarcode: false }),
    );

    await this.prisma.auditLog.create({
      data: { actorUid: actorId, action: 'ac_unit.create', target: unit.id, detail: { memberId, ...data } },
    });

    return unit;
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
      include: { member: true },
    });
    if (!unit) throw new NotFoundException('Unit tidak ditemukan / QR tidak valid');
    return this.buildDetail(unit);
  }

  /**
   * Sama kayak lookupByBarcode, tapi dicari pakai id (bukan scan barcode
   * fisik) — dipakai halaman web "Member" -> detail member -> klik salah
   * satu unit AC-nya -> lihat riwayat servis unit itu.
   */
  async findOne(id: string) {
    const unit = await this.prisma.memberAcUnit.findUnique({
      where: { id },
      include: { member: true },
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
  async update(id: string, dto: UpdateAcUnitDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.memberAcUnit.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Unit AC tidak ditemukan');

    const { installationDate, lastServiceDate, nextServiceDate, ...rest } = dto;
    const unit = await this.prisma.memberAcUnit.update({
      where: { id },
      data: {
        ...rest,
        ...(installationDate !== undefined ? { installationDate: new Date(installationDate) } : {}),
        ...(lastServiceDate !== undefined ? { lastServiceDate: new Date(lastServiceDate) } : {}),
        ...(nextServiceDate !== undefined ? { nextServiceDate: new Date(nextServiceDate) } : {}),
      },
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
    unit: Prisma.MemberAcUnitGetPayload<{ include: { member: true } }>,
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
