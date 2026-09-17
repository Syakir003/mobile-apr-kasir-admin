import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { TechnicianJobsService } from '../technician-jobs/technician-jobs.service';
import { ServiceIntakeDto } from './dto/service-intake.dto';

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
        invoice: { include: { items: true } },
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
