import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { assertNoActiveJob } from '../technician-jobs/active-job.util';
import { assertValidTechnicians, normalizeTechnicianIds } from '../technician-jobs/job-assignees';
import { resolveWorkLocation } from './work-location.util';
import { IntakeUnitDto, ServiceIntakeDto } from './dto/service-intake.dto';
import { UNIT_PRODUCTS_SELECT } from '../ac-units/ac-unit-products.include';
import { isUnitLabeled } from '../ac-units/unit-label-status.util';
import { CreateServiceOrderDto } from './dto/create-service-order.dto';
import { UpdateServiceOrderDto } from './dto/update-service-order.dto';

/**
 * Siklus 2 — Servis Masuk Mandiri: jalur masuk servis yang BUKAN dari
 * `pos/checkout` (customer bawa AC lama buat diperbaiki, bukan beli produk
 * baru). Reuse total ke engine job teknisi Siklus 1 (createForOrder, queue,
 * start/findings/materials/submitForReview di TechnicianJobsService) —
 * TIDAK ada logic baru di sana, cuma dipanggil dari titik masuk yang beda.
 */
@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly acUnits: AcUnitsService,
    private readonly technicianJobs: TechnicianJobsService,
  ) {}

  /**
   * POST /service-orders — port RPC create_service_order (migrasi Supabase
   * 0013) untuk app mobile: 1 order, N unit milik member yang sama, 1 job per
   * unit (lewat createForOrder, sama kayak intake). unitIds duplikat dibuang.
   */
  async createManual(dto: CreateServiceOrderDto, actorId: string) {
    const member = await this.prisma.member.findUnique({ where: { id: dto.memberId } });
    if (!member || !member.active) throw new BadRequestException('Member tidak ditemukan atau nonaktif');
    const technicianIds = normalizeTechnicianIds(dto);
    await assertValidTechnicians(this.prisma, technicianIds);
    const unitIds = [...new Set(dto.unitIds)];
    const units = await this.prisma.memberAcUnit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== unitIds.length) throw new NotFoundException('Unit AC tidak ditemukan');
    if (units.some((u) => u.memberId !== member.id)) {
      throw new BadRequestException('Unit AC bukan milik member tersebut');
    }

    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await assertNoActiveJob(tx, unitIds);
      const order = await tx.serviceOrder.create({
        data: {
          memberId: member.id,
          type: dto.type,
          status: 'terjadwal',
          note: dto.note?.trim() || null,
          scheduledDate,
          createdById: actorId,
        },
      });
      const assignedJobs: { jobId: string; technicianId: string | null; technicianIds: string[] }[] = [];
      for (const unitId of unitIds) {
        await tx.serviceOrderUnit.create({ data: { orderId: order.id, unitId, status: 'terjadwal' } });
        const job = await this.technicianJobs.createForOrder(tx, {
          orderId: order.id,
          memberId: member.id,
          unitId,
          technicianIds,
          type: dto.type,
          actorId,
          scheduledDate,
        });
        assignedJobs.push({ jobId: job.id, technicianId: job.technicianId, technicianIds });
      }
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'order.create',
          target: order.id,
          detail: { type: dto.type, jobs: unitIds.length, technicianId: technicianIds[0] ?? null, technicianIds },
        },
      });
      return { ok: true, orderId: order.id, jobCount: unitIds.length, assignedJobs };
    });
  }

  async intake(dto: ServiceIntakeDto, actorId: string) {
    // Satu atau banyak unit AC. Bentuk lama (existingUnitId/newUnit tunggal) tetap dipakai app mobile; bentuk baru
    // `units[]` untuk servis banyak AC dalam satu order. Keduanya dinormalkan jadi daftar entri di sini.
    const jobType = dto.jobType ?? 'perbaikan';
    const workDescription = dto.workDescription?.trim() || undefined;
    const complaint = dto.complaint?.trim() || undefined;
    if (!complaint) {
      throw new BadRequestException('Keluhan awal wajib diisi (kalau tidak ada keluhan, isi pekerjaannya, mis. Cuci AC)');
    }
    if (dto.units?.length && (dto.existingUnitId || dto.newUnit)) {
      throw new BadRequestException('Pakai units[] ATAU existingUnitId/newUnit, jangan keduanya');
    }
    const entries: IntakeUnitDto[] = dto.units?.length
      ? dto.units
      : [{ existingUnitId: dto.existingUnitId, newUnit: dto.newUnit }];
    const existingIds = new Set<string>();
    for (const e of entries) {
      if (!e.existingUnitId && !e.newUnit) {
        throw new BadRequestException('Wajib pilih unit existing (existingUnitId) atau isi data unit baru (newUnit)');
      }
      if (e.existingUnitId && e.newUnit) {
        throw new BadRequestException('Pilih salah satu: unit existing atau unit baru, jangan dua-duanya');
      }
      if (e.existingUnitId) {
        if (existingIds.has(e.existingUnitId)) {
          throw new BadRequestException('Unit AC yang sama dipilih lebih dari satu kali');
        }
        existingIds.add(e.existingUnitId);
      }
      const n = e.newUnit;
      if (n?.qrDulu && (n.brand || n.model || n.pk != null || n.serialNumber)) {
        throw new BadRequestException(
          'Mode "QR dulu" tidak menerima merk/model/PK/no. seri — teknisi yang melengkapinya saat scan di lokasi.',
        );
      }
    }

    // Titik lokasi kerja tiap unit (urut sama dengan entries). Dicek sebelum transaksi supaya pilihan yang salah jadi 400.
    const unitLocations = entries.map((e) => resolveWorkLocation(dto.locations, e.locationIndex));
    // Teknisi (maks 5, semua setara) divalidasi sebelum transaksi: id salah/nonaktif jadi 400, bukan order setengah jadi.
    const technicianIds = normalizeTechnicianIds(dto);
    await assertValidTechnicians(this.prisma, technicianIds);

    return this.prisma.$transaction(async (tx) => {
      // Sama pola persis kayak PosService.checkout(): kalau admin/kasir milih
      // member LAMA dari pencarian di form intake, pakai persis member itu
      // (skip findOrCreate by-phone) -> aman dari typo nomor HP yang bisa
      // bikin member duplikat gak sengaja.
      const member = dto.customer.memberId
        ? await tx.member.findUnique({ where: { id: dto.customer.memberId } })
        : (
            await this.members.findOrCreate(
              tx,
              dto.customer.name,
              dto.customer.phone,
              dto.customer.address,
              'retail',
              dto.customer.mapsUrl,
            )
          ).member;
      if (!member) throw new NotFoundException('Member yang dipilih tidak ditemukan');
      // Member lama (dipilih / ketemu via HP) belum tentu punya link lokasi: perbarui kalau kasir mengisinya.
      if (dto.customer.mapsUrl && member.mapsUrl !== dto.customer.mapsUrl) {
        await tx.member.update({ where: { id: member.id }, data: { mapsUrl: dto.customer.mapsUrl } });
      }

      // Unit lama yang sudah pernah terlabel QR tidak perlu dicetak lagi — frontend melewati halaman cetak label.
      // `labeled` dihitung SEBELUM job baru dibuat, supaya job ini sendiri tidak ikut dianggap "riwayat".
      const units: { id: string; barcodeValue: string; memberId: string; labeled: boolean }[] = [];
      let qrDuluCount = 0;
      let newUnitCount = 0;
      for (const e of entries) {
        if (e.existingUnitId) {
          const existing = await tx.memberAcUnit.findUnique({ where: { id: e.existingUnitId } });
          if (!existing) throw new NotFoundException('Unit AC tidak ditemukan');
          if (existing.memberId !== member.id) {
            throw new BadRequestException(
              'Unit ini terdaftar atas nama member lain — konfirmasi manual ke customer dulu sebelum lanjut',
            );
          }
          units.push({ ...existing, labeled: await isUnitLabeled(tx, existing) });
        } else {
          const nu = e.newUnit!;
          // "QR dulu" = jalur yang sama dengan Input Data Lampau (status menunggu_data, pengingat OFF); teknisi
          // melengkapi lewat Scan Unit (POST /ac-units/:id/complete-data), admin dikabari lewat lonceng.
          const created = nu.qrDulu
            ? await this.acUnits.createLegacy(tx, member.id, { mode: 'qr_dulu', roomLocation: nu.roomLocation })
            : await this.acUnits.registerExisting(tx, member.id, nu);
          if (nu.qrDulu) qrDuluCount++;
          newUnitCount++;
          units.push({ ...created, labeled: false });
        }
      }
      // Unit lama yang dipilih tidak boleh sedang punya job aktif (unit baru pasti belum punya job).
      await assertNoActiveJob(tx, [...existingIds]);
      if (newUnitCount > 0) {
        await tx.member.update({ where: { id: member.id }, data: { totalAcUnits: { increment: newUnitCount } } });
      }

      const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;

      const order = await tx.serviceOrder.create({
        data: {
          memberId: member.id,
          type: jobType,
          status: 'terjadwal',
          // Note pekerjaan untuk teknisi: deskripsi pekerjaan; tanpa itu keluhannya (perilaku lama).
          note: workDescription ?? complaint,
          scheduledDate,
          paymentMode: dto.paymentMode ?? 'bayar_di_lokasi',
          createdById: actorId,
        },
      });

      // Satu job per unit AC (temuan, foto, scan, riwayat servis tercatat per unit), semuanya di order yang sama
      // -> satu invoice (baris tagihan tiap job ditandai job_id, lihat JobBillingService).
      // complaint diteruskan ke createForOrder() supaya otomatis kebentuk 1
      // JobFinding awal (origin: 'komplain_awal') — teknisi gak mulai dari
      // kosong kalau customer sudah bilang keluhannya saat intake (Siklus 5
      // revisi, checklist temuan dinamis).
      const jobs: { id: string; status: string }[] = [];
      for (const [i, unit] of units.entries()) {
        await tx.serviceOrderUnit.create({
          data: { orderId: order.id, unitId: unit.id, status: 'terjadwal' },
        });
        jobs.push(
          await this.technicianJobs.createForOrder(tx, {
            orderId: order.id,
            memberId: member.id,
            unitId: unit.id,
            technicianIds,
            type: jobType,
            actorId,
            scheduledDate,
            complaint,
            ...unitLocations[i],
          }),
        );
      }

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'service_order.intake',
          target: order.id,
          detail: {
            unitId: units[0].id,
            jobId: jobs[0].id,
            jobType,
            unitIds: units.map((u) => u.id),
            jobIds: jobs.map((j) => j.id),
            ...(qrDuluCount > 0 ? { qrDulu: true, qrDuluCount } : {}),
          },
        },
      });

      // Field tingkat atas = unit/job PERTAMA (bentuk lama, dipakai app mobile); `jobs` memuat semuanya.
      return {
        serviceOrderId: order.id,
        memberId: member.id,
        unitId: units[0].id,
        barcodeValue: units[0].barcodeValue,
        unitLabeled: units[0].labeled,
        jobId: jobs[0].id,
        jobStatus: jobs[0].status,
        jobs: units.map((u, i) => ({
          jobId: jobs[i].id,
          jobStatus: jobs[i].status,
          unitId: u.id,
          barcodeValue: u.barcodeValue,
          unitLabeled: u.labeled,
        })),
        // Unit yang labelnya masih perlu dicetak (frontend: kosong = langsung ke halaman job).
        unitsToLabel: units.filter((u) => !u.labeled).map((u) => u.id),
      };
    });
  }

  /**
   * Detail 1 service order — dibutuhin buat cetak surat jalan (frontend)
   * abis checkout POS/intake servis mandiri. Sebelum ini gak ada cara ambil
   * balik detail order dari `serviceOrderId` yang dibalikin checkout() —
   * cuma id doang, gak ada endpoint buat resolve isinya (unit + barcode +
   * teknisi yang ditugasin).
   *
   * `invoice.items` ikut di-include (bukan cuma invoice header) — surat
   * jalan butuh daftar barang yang dikirim (nama + qty), diambil dari baris
   * invoice yang kind-nya bukan 'service' (jasa gak "dikirim", persis pola
   * delivery_note_pdf.dart di app Flutter lama). Order dari alur intake
   * servis mandiri gak punya invoice (bukan penjualan) — `invoice` bakal
   * null di sana, ditangani di sisi frontend.
   */
  async findOne(id: string) {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id },
      include: {
        member: true,
        transaction: true,
        // buyPriceSnapshot = harga modal, jangan sampai kebaca kasir.
        invoice: { include: { items: { omit: { buyPriceSnapshot: true } } } },
        createdBy: { select: { id: true, displayName: true } },
        serviceOrderUnits: { include: { unit: { include: UNIT_PRODUCTS_SELECT } } },
        units: { include: { technician: { select: { id: true, displayName: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Service order tidak ditemukan');
    return order;
  }

  /** Kasir cek status servis pelanggan — cari lewat nomor HP atau memberId langsung. */
  async findByCustomer(params: { phone?: string; memberId?: string }) {
    // Tanpa filter = daftar order terbaru (layar Order app mobile). Dulu 400;
    // web gak pernah manggil tanpa filter, jadi perilaku web gak berubah.
    if (!params.memberId && !params.phone) {
      return this.prisma.serviceOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          member: true,
          serviceOrderUnits: { include: { unit: true } },
          units: { include: { technician: { select: { id: true, displayName: true } } } },
        },
      });
    }
    let memberId = params.memberId;
    if (!memberId && params.phone) {
      const phone = this.members.normalizePhone(params.phone);
      const member = await this.prisma.member.findFirst({ where: { phone } });
      if (!member) return [];
      memberId = member.id;
    }
    if (!memberId) throw new BadRequestException('Wajib isi query ?phone= atau ?memberId=');

    return this.prisma.serviceOrder.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      include: {
        serviceOrderUnits: { include: { unit: { include: UNIT_PRODUCTS_SELECT } } },
        units: { include: { technician: { select: { id: true, displayName: true } } } },
      },
    });
  }

  /**
   * PATCH /service-orders/:id (admin) — koreksi data order yang salah dimasukkan saat Terima Servis: jadwal, jenis
   * pekerjaan, dan Note Pekerjaan (berlaku untuk SELURUH order), serta titik lokasi kerja per unit. Hanya job yang belum
   * selesai/dibatalkan yang diubah; order yang semua jobnya sudah selesai/dibatalkan ditolak. Jenis pekerjaan order
   * pemasangan (POS) tidak bisa diganti. Data pelanggan diedit lewat Ubah Member. Dicatat di audit log (nilai lama dan baru).
   */
  async update(orderId: string, dto: UpdateServiceOrderDto, actorId: string) {
    const locations = dto.unitLocations ?? [];
    if (
      dto.scheduledDate === undefined &&
      dto.jobType === undefined &&
      dto.note === undefined &&
      dto.paymentMode === undefined &&
      locations.length === 0
    ) {
      throw new BadRequestException('Tidak ada perubahan yang dikirim');
    }
    if (new Set(locations.map((l) => l.jobId)).size !== locations.length) {
      throw new BadRequestException('Titik lokasi kerja satu unit dikirim lebih dari sekali');
    }
    const FINISHED: string[] = [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan];

    return this.prisma.$transaction(async (tx) => {
      // Kunci semua job order ini (urut id) supaya tidak berbarengan dengan Ajukan Selesai/Setujui (pola submitOrderForReview).
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${orderId} ORDER BY id FOR UPDATE`;
      const order = await tx.serviceOrder.findUnique({ where: { id: orderId }, include: { units: { orderBy: { createdAt: 'asc' } } } });
      if (!order) throw new NotFoundException('Order tidak ditemukan');
      const open = order.units.filter((j) => !FINISHED.includes(j.status));
      if (open.length === 0) {
        throw new BadRequestException('Order ini sudah selesai atau dibatalkan, datanya tidak bisa diubah lagi');
      }
      if (dto.jobType !== undefined && (order.type === 'pemasangan' || open.some((j) => j.type === 'pemasangan'))) {
        throw new BadRequestException('Jenis pekerjaan order pemasangan tidak bisa diganti');
      }
      // Job komplain selalu 'perbaikan': persetujuannya tidak boleh menyentuh jadwal pengingat servis unit.
      if (dto.jobType !== undefined && open.some((j) => j.complaintOfJobId)) {
        throw new BadRequestException('Jenis pekerjaan job komplain tidak bisa diganti');
      }
      if (dto.paymentMode !== undefined && (order.type === 'pemasangan' || open.some((j) => j.type === 'pemasangan'))) {
        throw new BadRequestException('Cara tagih order pemasangan tidak bisa diganti');
      }

      const changes: Record<string, unknown> = {};
      const orderData: Prisma.ServiceOrderUpdateInput = {};
      const jobData: Prisma.TechnicianJobUpdateManyMutationInput = {};
      if (dto.scheduledDate !== undefined) {
        const date = new Date(dto.scheduledDate);
        orderData.scheduledDate = date;
        jobData.scheduledDate = date;
        changes.scheduledDate = { dari: order.scheduledDate?.toISOString() ?? null, jadi: date.toISOString() };
      }
      if (dto.jobType !== undefined) {
        orderData.type = dto.jobType;
        jobData.type = dto.jobType;
        changes.jobType = { dari: order.type, jadi: dto.jobType };
      }
      if (dto.note !== undefined) {
        const note = dto.note.trim() || null;
        orderData.note = note;
        changes.note = { dari: order.note, jadi: note };
      }
      if (dto.paymentMode !== undefined) {
        orderData.paymentMode = dto.paymentMode;
        changes.paymentMode = { dari: order.paymentMode, jadi: dto.paymentMode };
      }
      if (Object.keys(orderData).length > 0) {
        await tx.serviceOrder.update({ where: { id: orderId }, data: orderData });
      }
      if (Object.keys(jobData).length > 0) {
        await tx.technicianJob.updateMany({
          where: { orderId, status: { notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan] } },
          data: { ...jobData, updatedAt: new Date() },
        });
      }

      const lokasi: unknown[] = [];
      for (const loc of locations) {
        const job = open.find((j) => j.id === loc.jobId);
        if (!job) {
          throw new BadRequestException('Unit tidak ditemukan di order ini, atau job-nya sudah selesai/dibatalkan');
        }
        const workAddress = loc.address?.trim() || null;
        const workMapsUrl = loc.mapsUrl?.trim() || null;
        await tx.technicianJob.update({ where: { id: job.id }, data: { workAddress, workMapsUrl, updatedAt: new Date() } });
        lokasi.push({
          jobId: job.id,
          dari: { workAddress: job.workAddress, workMapsUrl: job.workMapsUrl },
          jadi: { workAddress, workMapsUrl },
        });
      }
      if (lokasi.length > 0) changes.lokasiKerja = lokasi;

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'order.update',
          target: orderId,
          detail: { changes, jobIds: open.map((j) => j.id) } as Prisma.InputJsonObject,
        },
      });
      return { ok: true, orderId, updatedJobs: open.length };
    });
  }
}
