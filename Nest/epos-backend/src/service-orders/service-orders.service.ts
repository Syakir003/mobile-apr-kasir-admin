import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { ServiceIntakeDto } from './dto/service-intake.dto';
import { CreateServiceOrderDto } from './dto/create-service-order.dto';

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
    if (dto.technicianId) {
      const tech = await this.prisma.user.findUnique({ where: { id: dto.technicianId } });
      if (!tech || tech.role !== 'teknisi' || !tech.active) {
        throw new BadRequestException('Teknisi tidak valid atau nonaktif');
      }
    }
    const unitIds = [...new Set(dto.unitIds)];
    const units = await this.prisma.memberAcUnit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== unitIds.length) throw new NotFoundException('Unit AC tidak ditemukan');
    if (units.some((u) => u.memberId !== member.id)) {
      throw new BadRequestException('Unit AC bukan milik member tersebut');
    }

    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;
    return this.prisma.$transaction(async (tx) => {
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
      const assignedJobs: { jobId: string; technicianId: string | null }[] = [];
      for (const unitId of unitIds) {
        await tx.serviceOrderUnit.create({ data: { orderId: order.id, unitId, status: 'terjadwal' } });
        const job = await this.technicianJobs.createForOrder(tx, {
          orderId: order.id,
          memberId: member.id,
          unitId,
          technicianId: dto.technicianId ?? null,
          type: dto.type,
          actorId,
          scheduledDate,
        });
        assignedJobs.push({ jobId: job.id, technicianId: job.technicianId });
      }
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'order.create',
          target: order.id,
          detail: { type: dto.type, jobs: unitIds.length, technicianId: dto.technicianId ?? null },
        },
      });
      return { ok: true, orderId: order.id, jobCount: unitIds.length, assignedJobs };
    });
  }

  async intake(dto: ServiceIntakeDto, actorId: string) {
    if (!dto.existingUnitId && !dto.newUnit) {
      throw new BadRequestException('Wajib pilih unit existing (existingUnitId) atau isi data unit baru (newUnit)');
    }
    if (dto.existingUnitId && dto.newUnit) {
      throw new BadRequestException('Pilih salah satu: unit existing atau unit baru, jangan dua-duanya');
    }

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
            )
          ).member;
      if (!member) throw new NotFoundException('Member yang dipilih tidak ditemukan');

      let unit: { id: string; barcodeValue: string; memberId: string };
      if (dto.existingUnitId) {
        const existing = await tx.memberAcUnit.findUnique({ where: { id: dto.existingUnitId } });
        if (!existing) throw new NotFoundException('Unit AC tidak ditemukan');
        if (existing.memberId !== member.id) {
          throw new BadRequestException(
            'Unit ini terdaftar atas nama member lain — konfirmasi manual ke customer dulu sebelum lanjut',
          );
        }
        unit = existing;
      } else {
        unit = await this.acUnits.registerExisting(tx, member.id, dto.newUnit!);
        await tx.member.update({ where: { id: member.id }, data: { totalAcUnits: { increment: 1 } } });
      }

      const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;

      const order = await tx.serviceOrder.create({
        data: {
          memberId: member.id,
          type: 'perbaikan',
          status: 'terjadwal',
          note: dto.complaint,
          scheduledDate,
          createdById: actorId,
        },
      });

      await tx.serviceOrderUnit.create({
        data: { orderId: order.id, unitId: unit.id, status: 'terjadwal' },
      });

      // complaint diteruskan ke createForOrder() supaya otomatis kebentuk 1
      // JobFinding awal (origin: 'komplain_awal') — teknisi gak mulai dari
      // kosong kalau customer sudah bilang keluhannya saat intake (Siklus 5
      // revisi, checklist temuan dinamis).
      const job = await this.technicianJobs.createForOrder(tx, {
        orderId: order.id,
        memberId: member.id,
        unitId: unit.id,
        technicianId: dto.technicianId ?? null,
        type: 'perbaikan',
        actorId,
        scheduledDate,
        complaint: dto.complaint,
      });

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'service_order.intake',
          target: order.id,
          detail: { unitId: unit.id, jobId: job.id },
        },
      });

      return {
        serviceOrderId: order.id,
        memberId: member.id,
        unitId: unit.id,
        barcodeValue: unit.barcodeValue,
        jobId: job.id,
        jobStatus: job.status,
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
        serviceOrderUnits: { include: { unit: true } },
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
        serviceOrderUnits: { include: { unit: true } },
        units: { include: { technician: { select: { id: true, displayName: true } } } },
      },
    });
  }
}
