import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockLockingService } from '../common/services/stock-locking.service';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import {
  CreateMaterialRequestDto,
  MaterialRequestItemDto,
} from './dto/create-material-request.dto';
import { DecideMaterialRequestDto } from './dto/decide-material-request.dto';
import { MaterialRequestQueryDto } from './dto/material-request-query.dto';

type Role = 'admin' | 'kasir' | 'teknisi';

/**
 * Port dari decide_material_request + mark_material_used
 * (payment_approval_photo_rules.sql). Alur ASLI (BEDA dari plan awal gue
 * yang langsung potong stok 1 langkah): teknisi ajukan (status 'pending',
 * BELUM potong stok) -> admin approve/revise/reject -> kalau approve/revise,
 * `invoice_adjustments` nambah tagihan invoice (sticky `kurang_bayar` kalau
 * invoice td-nya sudah lunas) -> teknisi tandai "used" BARU stok dipotong.
 */
@Injectable()
export class MaterialRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLocking: StockLockingService,
  ) {}

  /**
   * Siklus batch-cost (2026-09): kind='product' DICABUT dari scope pengajuan
   * material (lihat komentar di MaterialRequestItemDto) — sekarang cuma
   * nampung 'sparepart', jadi method ini gak perlu cabang per-kind lagi.
   * `kind` DTO-nya sendiri udah dikunci ke literal `'sparepart'` (class-
   * validator `@IsIn(['sparepart'])` nolak nilai lain SEBELUM nyampe sini),
   * tapi tetep dicek eksplisit di bawah sebagai pengaman kedua (defense in
   * depth) — kalau suatu saat ada pemanggil lain yang bypass DTO/pipe.
   */
  private async priceItems(items: MaterialRequestItemDto[]) {
    const priced: {
      kind: string;
      refId: string;
      name: string;
      unit: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }[] = [];
    for (const item of items) {
      if (item.kind !== 'sparepart') {
        throw new BadRequestException(
          `Pengajuan material cuma buat sparepart, bukan '${item.kind}'`,
        );
      }
      const sp = await this.prisma.sparepart.findUnique({
        where: { id: item.refId },
      });
      if (!sp || !sp.active)
        throw new BadRequestException(
          `Sparepart ${item.refId} tidak ditemukan/nonaktif`,
        );
      priced.push({
        kind: item.kind,
        refId: item.refId,
        name: sp.name,
        unit: sp.unit,
        qty: item.qty,
        unitPrice: Number(sp.sellPrice),
        lineTotal: Math.round(item.qty * Number(sp.sellPrice)),
      });
    }
    return priced;
  }

  /**
   * Halaman admin "Pengajuan Masuk" — daftar SEMUA pengajuan lintas
   * job/teknisi (beda dari materialRequests yang nempel di GET
   * /technician-jobs/:id, yang scope-nya cuma 1 job). `counts` dihitung
   * dari SEMUA baris (bukan cuma yang match filter `status`) — biar tab
   * "Pending 3 / Disetujui 1 / Ditolak 1" di UI tetap kebaca lengkap
   * walaupun user lagi nge-filter salah satu tab.
   */
  async findAll(query: MaterialRequestQueryDto) {
    const where = query.status ? { status: query.status } : {};
    // `count()` per status (bukan `groupBy`) — tipe hasilnya `number` polos,
    // gak ada ambiguitas TS kayak `groupBy()._count` yang bentuknya suka
    // ke-infer beda-beda tergantung konteks pemanggilan (sempat coba
    // `groupBy` duluan, tipe `_count`-nya malah ke-infer `true | {...}`
    // walau query-nya sendiri valid — daripada berkutat sama itu, 3x
    // `count()` lebih simpel & tipenya pasti benar).
    const [items, pending, approved, rejected] = await this.prisma.$transaction([
      this.prisma.materialRequest.findMany({
        where,
        include: {
          items: true,
          job: {
            select: {
              id: true,
              type: true,
              unit: { select: { brand: true, model: true, barcodeValue: true } },
              member: { select: { name: true } },
            },
          },
          createdBy: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.materialRequest.count({ where: { status: 'pending' } }),
      this.prisma.materialRequest.count({ where: { status: 'approved' } }),
      this.prisma.materialRequest.count({ where: { status: 'rejected' } }),
    ]);

    const counts = { all: pending + approved + rejected, pending, approved, rejected };
    return { items, counts };
  }

  /** Teknisi mengajukan sparepart tambahan saat servis on-site. Belum potong stok. */
  async create(
    jobId: string,
    dto: CreateMaterialRequestDto,
    actorId: string,
    role: Role,
  ) {
    // priceItems() panggil DB (findUnique produk/sparepart) — lakuin DULU DI
    // LUAR transaction biar transaction-nya sesingkat mungkin (cuma pegang
    // lock job row selama insert, bukan selama lookup harga).
    const priced = await this.priceItems(dto.items);
    const total = priced.reduce((sum, i) => sum + i.lineTotal, 0);

    return this.prisma.$transaction(async (tx) => {
      // Lock row job DULU (FOR UPDATE) sebelum baca status — pasangan dari
      // lock yang sama di TechnicianJobsService.submitForReview(). Tanpa
      // ini, submitForReview() bisa lolos cek "gak ada pending request" di
      // saat yang PERSIS bersamaan dengan create() ini baca status job
      // (masih 'sedang_dikerjakan') dari snapshot lama sebelum
      // submitForReview() commit — race TOCTOU klasik. Dengan lock yang
      // sama-sama dipasang di kedua sisi, siapa pun yang jalan duluan bikin
      // yang satunya NUNGGU baca status TERBARU (bukan snapshot basi).
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (role !== 'admin' && job.technicianId !== actorId) {
        throw new ForbiddenException('Job ini bukan milik Anda');
      }
      if (
        !(
          [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]
        ).includes(job.status)
      ) {
        throw new BadRequestException(
          'Pengajuan hanya bisa dibuat saat job aktif',
        );
      }

      return tx.materialRequest.create({
        data: {
          jobId,
          status: 'pending',
          total,
          note: dto.note,
          createdById: actorId,
          items: { create: priced },
        },
        include: { items: true },
      });
    });
  }

  /**
   * Admin approve/revise/reject. Approve/revise menambah tagihan invoice
   * lewat invoice_adjustments — SEBELUM stok dipotong (dipotong belakangan
   * di markUsed). Sticky rule (8.5): invoice yang tadinya `lunas` lalu
   * tagihannya naik -> `kurang_bayar`, BUKAN balik ke `dp`.
   */
  async decide(
    requestId: string,
    dto: DecideMaterialRequestDto,
    actorId: string,
  ) {
    // SEMUA di satu $transaction, dikunci FOR UPDATE duluan SEBELUM baca
    // status — sebelumnya baca+cek status 'pending' dilakukan di LUAR
    // transaction, jadi 2 approve/reject bersamaan buat pengajuan yang sama
    // bisa dua-duanya lolos cek "masih pending" terus dua-duanya nge-apply
    // perubahan (approve dobel = invoice ke-charge 2x). Row lock bikin yang
    // kedua nunggu yang pertama commit, baru baca status yang udah kebaruan
    // (bukan 'pending' lagi) dan ditolak dengan benar.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM material_requests WHERE id = ${requestId} FOR UPDATE`;
      const request = await tx.materialRequest.findUnique({
        where: { id: requestId },
        include: { items: true, job: { include: { order: true } } },
      });
      if (!request) throw new NotFoundException('Pengajuan tidak ditemukan');
      if (request.status !== 'pending') {
        throw new BadRequestException('Pengajuan sudah diputuskan');
      }

      if (dto.decision === 'reject') {
        const rejected = await tx.materialRequest.update({
          where: { id: requestId },
          data: {
            status: 'rejected',
            decidedById: actorId,
            decidedAt: new Date(),
            decisionNote: dto.decisionNote,
          },
        });
        // Bug ketauan pas tsc jalan beneran (server-side): cabang reject ini
        // sebelumnya `return` duluan TANPA technicianId — jadi walau admin
        // nolak pengajuan, teknisi pengaju gak pernah kekirim notifikasi
        // (MaterialRequestsController.decide() ngecek `result.technicianId`
        // sebelum notify()). Disamain bentuknya kayak return approve/revise
        // di bawah (technicianId + invoiceStatus, walau reject gak pernah
        // nyentuh invoice jadi tetep undefined).
        return { ...rejected, invoiceStatus: undefined, technicianId: request.job.technicianId };
      }

      let total: number = Number(request.total);
      if (dto.decision === 'revise') {
        if (!dto.items?.length) {
          throw new BadRequestException(
            'Revisi butuh daftar item {kind, refId, qty}',
          );
        }
        const priced = await this.priceItems(dto.items);
        total = priced.reduce((sum, i) => sum + i.lineTotal, 0);
        if (total <= 0)
          throw new BadRequestException('Revisi menyisakan pengajuan kosong');

        await tx.materialRequestItem.deleteMany({ where: { requestId } });
        for (const p of priced) {
          await tx.materialRequestItem.create({ data: { requestId, ...p } });
        }
      }

      const updated = await tx.materialRequest.update({
        where: { id: requestId },
        data: {
          status: 'approved',
          total,
          decidedById: actorId,
          decidedAt: new Date(),
          decisionNote: dto.decisionNote,
        },
      });

      const invoiceId = request.job.order?.invoiceId;
      let invoiceStatus: string | undefined;
      if (invoiceId) {
        // Lock invoice juga (FOR UPDATE, pola sama persis kayak
        // PaymentsService.record()) — biar approve pengajuan yang nambah
        // tagihan gak nubruk pembayaran yang direkam bersamaan di invoice
        // yang sama (invoice bisa kebaca status/grandTotal basi kalau
        // enggak dikunci).
        // `status` diketik langsung sebagai InvoiceStatus (bukan string) —
        // kolomnya emang enum Postgres di DB, raw query cuma gak lewat
        // Prisma punya type mapping otomatis kayak query biasa.
        const rows = await tx.$queryRaw<
          {
            id: string;
            grand_total: string;
            total_paid: string;
            status: InvoiceStatus;
          }[]
        >`SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
        const inv = rows[0];
        if (inv) {
          const newGrand = Number(inv.grand_total) + total;
          await tx.invoiceAdjustment.create({
            data: {
              invoiceId,
              requestId,
              amount: total,
              reason: 'pengajuan_tambahan',
              createdById: actorId,
            },
          });
          // Sudah lunas lalu tagihan naik -> kurang_bayar (rule 8.5, sticky).
          const baseline = inv.status === 'lunas' ? 'kurang_bayar' : inv.status;
          const newStatus = computeInvoiceStatus(
            newGrand,
            Number(inv.total_paid),
            baseline,
          );
          await tx.invoice.update({
            where: { id: invoiceId },
            data: { grandTotal: newGrand, status: newStatus },
          });
          invoiceStatus = newStatus;
          await tx.materialRequest.update({
            where: { id: requestId },
            data: { invoiceId },
          });
        }
      }

      // technicianId diikutkan di return (bukan cuma field materialRequest
      // biasa) — dipakai MaterialRequestsController buat notify() teknisi
      // pengaju tanpa perlu query ulang job-nya terpisah (request.job udah
      // ke-load di atas lewat include).
      return { ...updated, invoiceStatus, technicianId: request.job.technicianId };
    });
  }

  /** Teknisi (pemilik job) atau admin menandai material yang disetujui sudah dipakai — BARU stok dipotong di sini. */
  async markUsed(requestId: string, actorId: string, role: Role) {
    // Sama kayak decide() — validasi status HARUS di dalam transaction,
    // SETELAH row-nya dikunci FOR UPDATE. Kalau baca status di luar lock
    // (versi sebelumnya), dua panggilan markUsed() bersamaan (mis. teknisi
    // dobel-tap tombol, atau retry) bisa dua-duanya lolos cek "belum
    // dipakai" dan dua-duanya motong stok — StockLockingService cuma
    // ngunci baris sparepart/product-nya, BUKAN baris material_requests ini.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM material_requests WHERE id = ${requestId} FOR UPDATE`;
      const request = await tx.materialRequest.findUnique({
        where: { id: requestId },
        include: { items: true, job: true },
      });
      if (!request) throw new NotFoundException('Pengajuan tidak ditemukan');
      if (role !== 'admin' && request.job.technicianId !== actorId) {
        throw new ForbiddenException('Job ini bukan milik Anda');
      }
      if (request.status !== 'approved') {
        throw new BadRequestException(
          'Hanya pengajuan yang disetujui bisa ditandai dipakai',
        );
      }
      if (request.usedAt) {
        throw new BadRequestException('Material sudah ditandai dipakai');
      }

      for (const item of request.items) {
        // Siklus batch-cost (2026-09): kind='product' dicabut dari scope
        // pengajuan material — cuma 'sparepart' yang tersisa & tervalidasi
        // di priceItems(). Cek `=== 'sparepart'` di sini tetap dipertahankan
        // (bukan disederhanain jadi tanpa-if) sebagai pengaman kalau ada
        // baris lama/data legacy dengan kind lain nyangkut di DB.
        if (item.kind === 'sparepart') {
          await this.stockLocking.lockAndDeduct(
            tx,
            item.kind,
            // refId wajib diisi di CreateMaterialRequestDto (@IsNotEmpty) —
            // nullability di schema cuma pola generik ala invoice_items,
            // baris ini sendiri sama kayak stockMovement.create() di bawah
            // yang juga udah pakai `!` buat field yang sama.
            item.refId!,
            Number(item.qty),
          );
          await tx.stockMovement.create({
            data: {
              itemKind: item.kind,
              refId: item.refId!,
              name: item.name,
              qtyChange: new Prisma.Decimal(item.qty).neg(),
              reason: 'pemakaian_servis',
              createdById: actorId,
            },
          });
        }
      }
      return tx.materialRequest.update({
        where: { id: requestId },
        data: { usedAt: new Date(), usedById: actorId },
      });
    });
  }
}
