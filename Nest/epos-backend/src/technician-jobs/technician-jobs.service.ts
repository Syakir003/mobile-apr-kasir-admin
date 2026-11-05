import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  ProblemCategory,
  TechnicianJobStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobBillingService, unitInvoiceLabel } from '../common/services/job-billing.service';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { wibDayRange } from '../common/wib-date.util';
import { RemindersService } from '../reminders/reminders.service';
import { addDays, resolveApproveSchedule } from '../reminders/service-schedule.util';
import { ApproveCompleteDto } from './dto/approve-complete.dto';
import { releaseUnitMaintenanceTx } from './unit-maintenance.util';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UNIT_PRODUCTS_SELECT } from '../ac-units/ac-unit-products.include';
import { isUnitLabeled } from '../ac-units/unit-label-status.util';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { assertNoActiveJob } from './active-job.util';
import { AddUnitDto } from './dto/add-unit.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { INTAKE_JOB_TYPES } from '../service-orders/dto/service-intake.dto';

type Role = 'admin' | 'kasir' | 'teknisi' | 'gudang';

/**
 * Siklus 5 (revisi) — checklist temuan servis + review admin. Vokabuler
 * status: menunggu_penugasan -> assigned -> sedang_dikerjakan ->
 * menunggu_review -> selesai / dibatalkan (+ jalur balik
 * menunggu_review -> sedang_dikerjakan lewat sendBack).
 *
 * TIDAK ADA lagi tabel checklist TETAP (draft awal proyek ini salah
 * mengira begitu) — checklist di sini artinya daftar TEMUAN MASALAH
 * dinamis (JobFinding): 1 temuan otomatis dibuat dari komplain customer
 * saat intake (kalau ada), teknisi bisa nambah temuan lain sendiri kapan
 * saja selama job berjalan. Tiap temuan punya foto sebelum/sesudah sendiri
 * (JobFindingPhoto, boleh banyak per kind) — menggantikan foto level-job
 * (JobPhoto) yang dipakai model lama. Lihat plan
 * 2026-08-22-siklus-checklist-servis-review.md untuk detail lengkap.
 */
@Injectable()
export class TechnicianJobsService {
  private readonly logger = new Logger(TechnicianJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: RemindersService,
    private readonly whatsapp: WhatsappService,
    private readonly notifications: NotificationsService,
    private readonly jobBilling: JobBillingService,
    private readonly acUnits: AcUnitsService,
  ) {}

  private assertOwnerOrAdmin(
    job: { technicianId: string | null },
    actorId: string,
    role: Role,
  ) {
    if (role !== 'admin' && job.technicianId !== actorId) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
  }

  /** Pola sama seperti MembersService.findOrCreate: cari case-insensitive
   * dulu, kalau gak ketemu baru bikin baru dengan source='auto'.
   *
   * Ada celah race condition yang SENGAJA ditangani di sini (beda dari
   * MembersService.findOrCreate yang belum nangani ini): 2 teknisi bisa aja
   * ngetik kategori baru yang PERSIS SAMA di waktu yang nyaris bersamaan —
   * keduanya lolos cek "belum ada" lalu sama-sama coba create(), yang satu
   * bakal kena unique constraint violation (P2002) di kolom `name`. Kalau
   * gak ditangani, ini persis kelas bug yang sama kayak PK overflow kemarin:
   * error DB mentah bocor jadi 500 generik (HttpExceptionFilter cuma
   * nangkep HttpException). Di sini di-catch dan di-fallback ke re-fetch —
   * yang kalah race tetap dapet kategori yang bener (punya yang menang),
   * bukan error. */
  private async findOrCreateCategory(
    tx: Prisma.TransactionClient,
    opts: { categoryId?: string; categoryName?: string },
  ): Promise<ProblemCategory> {
    if (opts.categoryId) {
      const category = await tx.problemCategory.findUnique({
        where: { id: opts.categoryId },
      });
      if (!category) throw new BadRequestException('Kategori tidak ditemukan');
      return category;
    }
    const name = opts.categoryName?.trim();
    if (!name)
      throw new BadRequestException('categoryId atau categoryName wajib diisi');

    const existing = await tx.problemCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;

    try {
      return await tx.problemCategory.create({
        data: { name, source: 'auto' },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await tx.problemCategory.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /** Autocomplete input judul temuan (dipanggil teknisi saat mengetik). */
  async searchCategories(query: string) {
    return this.prisma.problemCategory.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  /** Admin nambah kategori baku secara manual (di luar flow auto-create saat
   * teknisi ngetik bebas). source tetap 'seed' — bukan cuma buat seeding awal,
   * tapi menandai ini kategori yang SENGAJA dikurasi (bukan hasil ketikan
   * teknisi di lapangan, yang source-nya 'auto'). */
  async createCategory(name: string) {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Nama kategori wajib diisi');
    const existing = await this.prisma.problemCategory.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing)
      throw new BadRequestException('Kategori dengan nama ini sudah ada');
    try {
      return await this.prisma.problemCategory.create({
        data: { name: trimmed, source: 'seed' },
      });
    } catch (err) {
      // Race condition sama kayak findOrCreateCategory: kalau ada request lain
      // yang menang bikin nama yang sama persis di antara cek & create di atas.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Kategori dengan nama ini sudah ada');
      }
      throw err;
    }
  }

  /**
   * `hasBeforePhoto` ditambahin (bukan cuma member+unit kayak sebelumnya) —
   * dipakai dashboard teknisi buat proaktif nunjukin job 'assigned' mana
   * yang masih kena gate "foto sebelum wajib ada" di start() sebelum
   * teknisinya klik sendiri & baru tau lewat error 400. Sengaja cuma
   * `select photos where kind='sebelum' take:1` per temuan (bukan
   * include penuh findings+photos kayak findOne()) biar payload list ini
   * tetap ringan — cukup tau ADA/ENGGAK, detail lengkapnya tetap di
   * halaman detail job.
   */
  /** GET /technician-jobs/mine — SEMUA job milik teknisi, status apa pun
   * (app mobile). queue cuma assigned/sedang_dikerjakan & history cuma
   * selesai, jadi job menunggu_review/dibatalkan gak kelihatan di mana pun. */
  async mine(technicianId: string) {
    return this.prisma.technicianJob.findMany({
      where: { technicianId },
      include: {
        member: true,
        unit: true,
        technician: { select: { id: true, displayName: true, email: true } },
        order: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async myQueue(technicianId: string) {
    const jobs = await this.prisma.technicianJob.findMany({
      where: {
        technicianId,
        status: { in: [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] },
      },
      include: {
        member: true,
        unit: { include: UNIT_PRODUCTS_SELECT },
        findings: {
          select: {
            photos: { where: { kind: 'sebelum' }, select: { id: true }, take: 1 },
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });
    return jobs.map(({ findings, ...job }) => ({
      ...job,
      hasBeforePhoto: findings.some((f) => f.photos.length > 0),
    }));
  }

  /**
   * Siklus 9 (Mode Offline Teknisi) — payload GEMUK buat precache harian:
   * semua job aktif milik teknisi ini (dijadwalkan hari ini ATAU masih
   * berjalan dari hari sebelumnya) LENGKAP dengan temuan+foto+material
   * request-nya, plus sparepart terlaris buat autocomplete lokal. Tujuannya
   * biar Flutter cache SEMUANYA sekali di sini sebelum berangkat — teknisi
   * gak boleh perlu hit endpoint lain per job pas udah di lapangan tanpa
   * sinyal.
   *
   * Vokabuler status di-samain sama myQueue()/findOne() Siklus 5 revisi
   * ('assigned'/'sedang_dikerjakan' — BUKAN 'in_progress' yang dipakai draft
   * plan awal proyek ini, itu nama status yang gak pernah ada di sistem ini).
   */
  async todayBundle(technicianId: string) {
    // Fix bug class yang sama kayak CountersService.dateKey()/DashboardService
    // (audit): setHours(0,0,0,0) versi lama itung "hari ini" di timezone
    // lokal proses Node, bukan WIB — kalau server TZ=UTC, precache teknisi
    // bisa kelewat/nyangkut job yang dijadwalkan jam-jam awal/akhir hari WIB.
    const { start: startOfToday, end: endOfToday } = wibDayRange();

    const jobs = await this.prisma.technicianJob.findMany({
      where: {
        technicianId,
        OR: [
          { scheduledDate: { gte: startOfToday, lte: endOfToday } },
          {
            status: {
              in: [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan],
            },
          },
        ],
      },
      include: {
        member: true,
        unit: { include: UNIT_PRODUCTS_SELECT },
        order: true,
        findings: {
          include: {
            category: true,
            photos: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        },
        materialRequests: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    const topSpareparts = await this.topUsedSpareparts();

    return { generatedAt: new Date(), jobs, topSpareparts };
  }

  /** Top 20 sparepart terlaris 30 hari terakhir — buat precache autocomplete
   * offline (Flutter gak bisa hit GET /spareparts/search tanpa sinyal). Data
   * toko-wide (bukan per-teknisi), diambil dari MaterialRequestItem —
   * artinya ini "sparepart yang paling sering DIAJUKAN teknisi buat servis",
   * bukan "sparepart yang paling laku dijual di POS" (dua hal beda). */
  private async topUsedSpareparts() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const grouped = await this.prisma.materialRequestItem.groupBy({
      by: ['refId'],
      where: {
        kind: 'sparepart',
        request: { createdAt: { gte: thirtyDaysAgo } },
      },
      _count: { refId: true },
      orderBy: { _count: { refId: 'desc' } },
      take: 20,
    });
    if (grouped.length === 0) return [];

    const refIds = grouped
      .map((g) => g.refId)
      .filter((id): id is string => id !== null);
    const spareparts = await this.prisma.sparepart.findMany({
      where: { id: { in: refIds }, active: true },
    });
    const frequencyById = new Map(
      grouped.map((g) => [g.refId, g._count.refId]),
    );

    return spareparts
      .map((sp) => ({ ...sp, frequency: frequencyById.get(sp.id) ?? 0 }))
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Ditambahkan untuk kebutuhan uji coba siklus (admin/kasir belum punya cara
   * lihat semua job — RPC asli juga tak pernah butuh ini karena Flutter admin
   * langsung query Supabase). Tidak ada di RPC manapun, murni CRUD read.
   */
  async findAll(status?: TechnicianJobStatus) {
    return this.prisma.technicianJob.findMany({
      where: status ? { status } : undefined,
      include: {
        member: true,
        unit: { include: UNIT_PRODUCTS_SELECT },
        technician: { select: { id: true, displayName: true, email: true } },
        order: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * `actorId`/`role` WAJIB diisi (bukan opsional) — sebelumnya method ini
   * gak ada ownership check sama sekali, jadi teknisi A yang tau/nebak ID
   * job teknisi B bisa liat data customer (nama/telepon/alamat), temuan, dan
   * foto job yang bukan miliknya (IDOR). Beda dari assertOwnerOrAdmin biasa
   * (yang cuma bebasin 'admin'): endpoint ini juga dipakai 'kasir'
   * (@Roles('admin','kasir','teknisi') di controller), jadi kasir tetap
   * bebas akses semua job — yang DIBATASI cuma role 'teknisi' ke job bukan
   * miliknya.
   */
  async findOne(jobId: string, actorId: string, role: Role) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      include: {
        member: true,
        unit: { include: UNIT_PRODUCTS_SELECT },
        technician: { select: { id: true, displayName: true, email: true } },
        // order.invoice = pengganti RPC job_payment_info (app mobile): cuma
        // field yang sama dengan RPC-nya, teknisi cuma bisa buka job miliknya.
        order: {
          include: {
            invoice: { select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true } },
          },
        },
        photos: { orderBy: { createdAt: 'asc' } }, // model lama, cuma keisi utk job pra-migrasi
        // Nama pencatat temuan & pengunggah foto: setelah alih tugas, teknisi baru melihat pekerjaan teknisi sebelumnya
        // berikut namanya.
        findings: {
          include: {
            category: true,
            createdBy: { select: { id: true, displayName: true } },
            photos: {
              orderBy: { createdAt: 'asc' },
              include: { uploadedBy: { select: { id: true, displayName: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        materialRequests: {
          include: { items: true },
          orderBy: { createdAt: 'desc' },
        },
        // Job komplain: menunjuk job selesai yang dikomplain; job selesai: daftar komplain atasnya (kosong = tidak ada).
        complaintOf: {
          select: { id: true, completedAt: true, orderId: true, technician: { select: { displayName: true } } },
        },
        complaints: { select: { id: true, status: true, createdAt: true, orderId: true }, orderBy: { createdAt: 'asc' } },
        // Riwayat alih tugas (kosong untuk job yang tidak pernah dialihkan).
        handovers: {
          include: {
            fromTechnician: { select: { id: true, displayName: true } },
            toTechnician: { select: { id: true, displayName: true } },
            handedBy: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (role === 'teknisi' && job.technicianId !== actorId) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    // Servis banyak AC: job lain di order yang sama (satu job per unit). Halaman job menampilkan semuanya sebagai
    // section per unit. Order pemasangan (POS) sengaja tidak digabung. Teknisi hanya melihat saudara miliknya sendiri
    // (GET :id untuk job teknisi lain 403).
    const siblings =
      job.order.type === 'pemasangan'
        ? []
        : await this.prisma.technicianJob.findMany({
            where: {
              orderId: job.orderId,
              id: { not: job.id },
              ...(role === 'teknisi' ? { technicianId: actorId } : {}),
            },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          });
    // `unit.labeled`: QR unit sudah pernah dilabeli (ada riwayat sebelum job ini) — kartu QR di halaman job menampilkannya.
    if (!job.unit) return { ...job, siblings };
    return {
      ...job,
      siblings,
      unit: { ...job.unit, labeled: await isUnitLabeled(this.prisma, job.unit, job.createdAt) },
    };
  }

  /**
   * Dipakai bareng oleh PosService (instalasi, Siklus 1) DAN ServiceOrdersService
   * (servis masuk mandiri, Siklus 2) — satu tempat buat bikin technician_jobs baru,
   * biar statusnya konsisten (otomatis 'assigned' kalau technicianId diisi,
   * 'menunggu_penugasan' kalau belum) dan gak ada logic dobel di dua tempat.
   *
   * Kalau `complaint` diisi (servis masuk mandiri selalu ada; instalasi
   * murni biasanya tidak), otomatis dibuatkan 1 JobFinding awal
   * (origin: 'komplain_awal') supaya teknisi gak mulai dari kosong kalau
   * customer memang sudah bilang keluhannya di titik intake.
   */
  async createForOrder(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      memberId: string;
      unitId: string;
      technicianId?: string | null;
      type: string;
      actorId: string;
      scheduledDate?: Date;
      complaint?: string;
      // Titik lokasi kerja unit ini bila berbeda dari alamat pelanggan (null/kosong = ikut alamat member).
      workAddress?: string | null;
      workMapsUrl?: string | null;
      // Job komplain: menunjuk job selesai yang dikomplain (lihat createComplaint). null/kosong = job biasa.
      complaintOfJobId?: string | null;
    },
  ) {
    const now = new Date();
    const job = await tx.technicianJob.create({
      data: {
        orderId: params.orderId,
        memberId: params.memberId,
        unitId: params.unitId,
        technicianId: params.technicianId ?? undefined,
        type: params.type,
        status: params.technicianId
          ? TechnicianJobStatus.assigned
          : TechnicianJobStatus.menunggu_penugasan,
        scheduledDate: params.scheduledDate,
        workAddress: params.workAddress ?? null,
        workMapsUrl: params.workMapsUrl ?? null,
        complaintOfJobId: params.complaintOfJobId ?? null,
        createdById: params.actorId,
        updatedAt: now,
      },
    });

    if (params.complaint?.trim()) {
      const category = await this.findOrCreateCategory(tx, {
        categoryName: params.complaint,
      });
      await tx.jobFinding.create({
        data: {
          jobId: job.id,
          categoryId: category.id,
          title: params.complaint.trim(),
          origin: 'komplain_awal',
          createdById: params.actorId,
        },
      });
    }

    return job;
  }

  /**
   * Teknisi menambah unit AC ke jobnya yang berstatus DITUGASKAN atau SEDANG DIKERJAKAN (customer minta AC lain ikut
   * diservis di tempat). Hanya pemilik job (atau admin) yang boleh; teknisi lain baru bisa lewat alih tugas.
   * Satu unit tambahan = satu job baru di ORDER YANG SAMA (satu nota, harga jasa & transport tetap satu untuk seluruh
   * job), dipegang teknisi pemilik job ini, dengan temuan awal dari `complaint` supaya tempat foto sebelum/sesudah +
   * deskripsi langsung ada. Dua jalur:
   *  - `barcode`: unit sudah berlabel -> harus milik pelanggan yang sama dan tidak punya job aktif;
   *  - `newUnit`: AC belum pernah tercatat -> unit baru "QR dulu" (status menunggu_data, pengingat OFF) yang otomatis
   *    masuk daftar AC pelanggan; teknisi mencetak labelnya, scan QR-nya di Scan Unit, lalu mengisi merk/PK.
   * Job baru berstatus Ditugaskan: foto sebelum + scan barcode (Mulai Job) tetap wajib seperti unit lain, dan "Ajukan
   * Selesai" menunggu semua unit dimulai. Bila harga jasa sudah ditetapkan, unit baru BELUM dihargai (billingDerived
   * false) sehingga admin harus memperbarui harga jasa dulu sebelum menyetujui (lihat assertJobPriced).
   */
  async addUnit(jobId: string, dto: AddUnitDto, actorId: string, role: Role) {
    const complaint = dto.complaint?.trim();
    if (!complaint) {
      throw new BadRequestException(
        'Isi pekerjaan/keluhan unit ini dulu (kalau tidak ada keluhan, isi pekerjaannya, mis. Cuci AC)',
      );
    }
    const barcode = dto.barcode?.trim();
    if (barcode && dto.newUnit) {
      throw new BadRequestException('Pilih salah satu: scan barcode unit yang sudah berlabel ATAU AC tanpa label, jangan dua-duanya');
    }
    if (!barcode && !dto.newUnit) {
      throw new BadRequestException('Scan barcode unit yang sudah berlabel, atau pilih AC tanpa label');
    }
    if (barcode && dto.roomLocation?.trim()) {
      throw new BadRequestException('Ruangan hanya diisi untuk AC tanpa label (unit berlabel sudah punya datanya)');
    }

    return this.prisma.$transaction(async (tx) => {
      const found = await tx.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!found) throw new NotFoundException('Job tidak ditemukan');
      // Kunci semua job order ini (urut id, sama dengan pengajuan selesai satu order) supaya penambahan unit tidak
      // bertabrakan dengan "Ajukan Selesai (semua unit)" yang sedang berjalan.
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${found.orderId} ORDER BY id FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({
        where: { id: jobId },
        include: {
          member: { select: { id: true, name: true } },
          technician: { select: { displayName: true } },
        },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      this.assertOwnerOrAdmin(job, actorId, role);
      // Ditugaskan juga boleh: customer sering minta tambah AC begitu teknisi tiba, sebelum sempat memulai job.
      if (job.status !== TechnicianJobStatus.assigned && job.status !== TechnicianJobStatus.sedang_dikerjakan) {
        throw new BadRequestException('Unit AC baru hanya bisa ditambahkan saat job Ditugaskan atau Sedang Dikerjakan');
      }
      if (job.type === 'pemasangan') {
        throw new BadRequestException(
          'Order pemasangan tidak bisa ditambah unit dari sini. Buat servis baru lewat Terima Servis.',
        );
      }
      if (!job.memberId) {
        throw new BadRequestException('Job ini tidak punya pelanggan, unit tidak bisa ditambahkan');
      }
      const jobType =
        dto.jobType ?? ((INTAKE_JOB_TYPES as readonly string[]).includes(job.type) ? job.type : 'perbaikan');

      let unit: { id: string; barcodeValue: string; status: string };
      if (barcode) {
        const existing = await tx.memberAcUnit.findUnique({ where: { barcodeValue: barcode } });
        if (!existing) throw new NotFoundException('Unit tidak ditemukan / QR tidak valid');
        if (existing.memberId !== job.memberId) {
          throw new BadRequestException(
            'Unit ini terdaftar atas nama pelanggan lain, bukan pelanggan job ini. Konfirmasi ke admin dulu sebelum lanjut.',
          );
        }
        const alreadyHere = await tx.technicianJob.count({
          where: { orderId: job.orderId, unitId: existing.id, status: { not: TechnicianJobStatus.dibatalkan } },
        });
        if (alreadyHere > 0) throw new BadRequestException('Unit ini sudah ada di job ini');
        await assertNoActiveJob(tx, [existing.id]);
        unit = existing;
      } else {
        unit = await this.acUnits.createLegacy(tx, job.memberId, { mode: 'qr_dulu', roomLocation: dto.roomLocation });
        await tx.member.update({ where: { id: job.memberId }, data: { totalAcUnits: { increment: 1 } } });
      }

      // Unit pernah ada di order ini (jobnya dibatalkan) dipakai ulang barisnya, bukan dobel.
      const orderUnit = await tx.serviceOrderUnit.findFirst({ where: { orderId: job.orderId, unitId: unit.id } });
      if (orderUnit) {
        await tx.serviceOrderUnit.update({ where: { id: orderUnit.id }, data: { status: 'terjadwal' } });
      } else {
        await tx.serviceOrderUnit.create({ data: { orderId: job.orderId, unitId: unit.id, status: 'terjadwal' } });
      }
      const newJob = await this.createForOrder(tx, {
        orderId: job.orderId,
        memberId: job.memberId,
        unitId: unit.id,
        technicianId: job.technicianId,
        type: jobType,
        actorId,
        scheduledDate: job.scheduledDate ?? undefined,
        complaint,
        // Unit tambahan umumnya di tempat yang sama dengan job asalnya: lokasi kerjanya diwarisi.
        workAddress: job.workAddress,
        workMapsUrl: job.workMapsUrl,
      });
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'job.add_unit',
          target: newJob.id,
          detail: { fromJobId: job.id, orderId: job.orderId, unitId: unit.id, jobType, newUnit: !barcode },
        },
      });
      const order = await tx.serviceOrder.findUnique({ where: { id: job.orderId }, select: { invoiceId: true } });
      return {
        ok: true,
        jobId: newJob.id,
        orderId: job.orderId,
        unitId: unit.id,
        barcodeValue: unit.barcodeValue,
        // AC tanpa label: QR baru, teknisi yang mencetak (halaman cetak label teknisi).
        needsLabel: !barcode,
        // Unit "QR dulu": merk/PK harus dilengkapi lewat Scan Unit sebelum unit bisa dimulai.
        needsData: unit.status === 'menunggu_data',
        // Invoice sudah ada = harga jasa pernah ditetapkan; unit baru ini belum ikut dihargai.
        needsPricing: !!order?.invoiceId,
        jobType,
        customerName: job.member?.name ?? null,
        technicianName: job.technician?.displayName ?? null,
      };
    });
  }

  /**
   * Komplain pelanggan atas job yang sudah SELESAI (admin; tombol "Komplain" di Detail Order). Job awal dibiarkan utuh:
   * temuan, foto, tagihan, dan jadwal pengingatnya tidak disentuh. Yang dibuat adalah ORDER BARU (tanpa nota) berisi satu
   * job komplain per unit yang dipilih, dengan data pelanggan/unit/lokasi disalin dari job awal sehingga admin tidak
   * mengisi ulang apa pun:
   *  - keluhan jadi temuan awal (origin komplain_awal) = section temuan & foto sebelum/sesudah BARU, terpisah dari temuan
   *    job awal (foto job awal tidak bercampur dengan foto pengerjaan komplain);
   *  - alur kerja sama dengan job biasa: teknisi scan barcode unit + foto sebelum untuk Mulai Job, melengkapi temuan &
   *    foto, Ajukan Selesai, admin menyetujui. TANPA penetapan harga jasa dan tagihan baru (lihat assertJobPriced,
   *    ServicePricingService.set, sendFindings);
   *  - jenis pekerjaan 'perbaikan' supaya persetujuannya tidak mengubah siklus/jadwal pengingat servis unit.
   * Satu keluhan bisa mencakup beberapa unit dari order yang sama (`jobIds`). Unit yang masih punya job aktif ditolak.
   * Teknisi bawaan = teknisi job awal (bila masih aktif); `technicianId: null` = belum ditentukan.
   */
  async createComplaint(jobId: string, dto: CreateComplaintDto, actorId: string) {
    const complaint = dto.complaint?.trim();
    if (!complaint) throw new BadRequestException('Isi keluhan pelanggan dulu');
    const scheduledDate = new Date(dto.scheduledDate);
    if (Number.isNaN(scheduledDate.getTime())) throw new BadRequestException('Jadwal tidak valid');
    const wantedIds = [...new Set(dto.jobIds?.length ? dto.jobIds : [jobId])];

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      // Kunci semua job order asal (urut id) supaya dua komplain bersamaan pada unit yang sama tidak sama-sama lolos.
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${base.orderId} ORDER BY id FOR UPDATE`;
      const sources = await tx.technicianJob.findMany({
        where: { id: { in: wantedIds } },
        include: {
          member: { select: { id: true, name: true } },
          unit: { select: { brand: true, model: true, roomLocation: true, barcodeValue: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (sources.length !== wantedIds.length) throw new NotFoundException('Ada job yang dipilih tidak ditemukan');
      for (const s of sources) {
        if (s.orderId !== base.orderId) {
          throw new BadRequestException('Unit yang dipilih harus berasal dari order yang sama');
        }
        if (s.status !== TechnicianJobStatus.selesai) {
          throw new BadRequestException(
            `Komplain hanya untuk job yang sudah Selesai (${this.unitName(s.unit)} belum selesai)`,
          );
        }
        if (!s.unitId || !s.memberId) {
          throw new BadRequestException('Job tanpa unit AC atau pelanggan tidak bisa dikomplain');
        }
      }
      // Job komplain baru tidak boleh menumpuk dengan job aktif lain pada unit yang sama.
      await assertNoActiveJob(tx, sources.map((s) => s.unitId as string));

      const first = sources[0];
      let technicianId: string | null;
      if (dto.technicianId === undefined) {
        // Bawaan: teknisi job awal, kalau akunnya sudah nonaktif/bukan teknisi jadi "belum ditentukan" (admin menugaskan).
        const prev = first.technicianId
          ? await tx.user.findUnique({ where: { id: first.technicianId }, select: { role: true, active: true } })
          : null;
        technicianId = prev && prev.role === 'teknisi' && prev.active ? first.technicianId : null;
      } else if (dto.technicianId === null) {
        technicianId = null;
      } else {
        const tech = await tx.user.findUnique({ where: { id: dto.technicianId }, select: { role: true, active: true } });
        if (!tech || tech.role !== 'teknisi' || !tech.active) {
          throw new BadRequestException('Teknisi tidak valid atau tidak aktif');
        }
        technicianId = dto.technicianId;
      }

      const order = await tx.serviceOrder.create({
        data: {
          memberId: first.memberId,
          type: 'perbaikan',
          status: 'terjadwal',
          scheduledDate,
          createdById: actorId,
        },
      });
      const created: { jobId: string; fromJobId: string; unitId: string }[] = [];
      for (const s of sources) {
        await tx.serviceOrderUnit.create({
          data: { orderId: order.id, unitId: s.unitId as string, status: 'terjadwal' },
        });
        const newJob = await this.createForOrder(tx, {
          orderId: order.id,
          memberId: s.memberId as string,
          unitId: s.unitId as string,
          technicianId,
          type: 'perbaikan',
          actorId,
          scheduledDate,
          complaint,
          // Lokasi kerja sama dengan job awal (unit yang sama), jadi admin tidak mengisinya lagi.
          workAddress: s.workAddress,
          workMapsUrl: s.workMapsUrl,
          complaintOfJobId: s.id,
        });
        created.push({ jobId: newJob.id, fromJobId: s.id, unitId: s.unitId as string });
        await tx.auditLog.create({
          data: {
            actorUid: actorId,
            action: 'job.complaint',
            target: newJob.id,
            detail: { fromJobId: s.id, fromOrderId: base.orderId, orderId: order.id, unitId: s.unitId, technicianId },
          },
        });
      }
      return {
        ok: true,
        orderId: order.id,
        jobId: created[0].jobId,
        jobs: created,
        technicianId,
        customerName: first.member?.name ?? null,
      };
    });
  }

  /**
   * Data label QR unit-unit satu order untuk halaman cetak label TEKNISI. Bentuknya sama dengan potongan
   * GET /service-orders/:id yang dipakai cetak label admin/kasir (endpoint itu terlalu lebar untuk teknisi: memuat
   * nota). Teknisi hanya mendapat unit yang job-nya miliknya; `unitIds` menyaring unit tertentu.
   */
  async unitLabels(jobId: string, actorId: string, role: Role, unitIds?: string[]) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { orderId: true, technicianId: true, member: { select: { id: true, name: true, address: true } } },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    const rows = await this.prisma.serviceOrderUnit.findMany({
      where: {
        orderId: job.orderId,
        ...(unitIds?.length ? { unitId: { in: unitIds } } : {}),
        ...(role === 'teknisi'
          ? { unit: { technicianJobs: { some: { orderId: job.orderId, technicianId: actorId } } } }
          : {}),
      },
      include: { unit: { include: UNIT_PRODUCTS_SELECT } },
    });
    return {
      id: job.orderId,
      member: job.member,
      serviceOrderUnits: rows.map((r) => ({ id: r.id, unit: r.unit })),
    };
  }

  /**
   * Riwayat job selesai milik teknisi yang login (Siklus 2). technicianId
   * WAJIB dari JWT `sub`, bukan query param — sama seperti myQueue() di atas,
   * biar teknisi A gak bisa liat riwayat teknisi B.
   */
  async history(technicianId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.technicianJob.findMany({
        where: { technicianId, status: TechnicianJobStatus.selesai },
        include: { member: true, unit: { include: UNIT_PRODUCTS_SELECT }, order: true },
        orderBy: { completedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.technicianJob.count({
        where: { technicianId, status: TechnicianJobStatus.selesai },
      }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Admin/kasir menugaskan atau mengalihtugaskan teknisi (Task 5.1). Alih tugas boleh KAPAN SAJA selama job belum
   * selesai/dibatalkan: sebelum mulai ('assigned'), sudah dikerjakan sebagian ('sedang_dikerjakan': teknisi
   * berhalangan / pekerjaan dilanjut hari lain), atau sudah diajukan ('menunggu_review') — dua yang terakhir HANYA
   * admin. Job yang sedang dikerjakan kembali ke 'assigned' setelah dialihkan: temuan & foto teknisi sebelumnya tetap,
   * tetapi teknisi baru wajib scan ulang barcode unit (Mulai Job) sebelum melanjutkan. Job 'menunggu_review' tetap
   * menunggu review (pekerjaan sudah selesai, tidak perlu dikembalikan/scan ulang): admin tetap bisa menyetujuinya
   * siapa pun teknisinya. Tiap pergantian dari teknisi lama ke teknisi lain dicatat di JobHandover (+ audit log).
   * Servis banyak AC (`allInOrder`): semua unit order yang masih bisa dialihkan ikut pindah ke teknisi yang sama.
   */
  async assign(
    jobId: string,
    technicianId: string,
    opts: { allInOrder?: boolean; actorId: string; role: Role; reason?: string },
  ) {
    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });
    if (!technician || technician.role !== 'teknisi' || !technician.active) {
      throw new BadRequestException('Teknisi tidak valid atau tidak aktif');
    }
    const reassignable = [
      TechnicianJobStatus.menunggu_penugasan,
      TechnicianJobStatus.assigned,
      TechnicianJobStatus.sedang_dikerjakan,
      TechnicianJobStatus.menunggu_review,
    ] as TechnicianJobStatus[];
    // Status yang sudah melewati titik "mulai": hanya admin yang boleh mengalihkannya.
    const adminOnly = [TechnicianJobStatus.sedang_dikerjakan, TechnicianJobStatus.menunggu_review] as TechnicianJobStatus[];
    const reason = opts.reason?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      // Kunci job order ini (urut id) supaya dua pengalihan/pengajuan bersamaan tidak saling menimpa.
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${base.orderId} ORDER BY id FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      // Job yang sudah selesai/dibatalkan final: tidak di-assign ulang.
      if (!reassignable.includes(job.status)) {
        throw new BadRequestException('Job yang selesai/dibatalkan tidak bisa di-assign ulang');
      }
      if (adminOnly.includes(job.status) && job.technicianId === technicianId) {
        throw new BadRequestException('Job ini sudah dipegang teknisi tersebut');
      }

      const targets = [job];
      if (opts.allInOrder) {
        // Saudara yang sudah selesai/batal tidak disentuh.
        targets.push(
          ...(await tx.technicianJob.findMany({
            where: { orderId: job.orderId, id: { not: jobId }, status: { in: reassignable } },
          })),
        );
      }

      // Mengalihkan job yang sedang dikerjakan / menunggu review hanya boleh admin (kasir tetap boleh menugaskan/mengganti
      // sebelum mulai).
      if (opts.role !== 'admin' && targets.some((t) => adminOnly.includes(t.status))) {
        throw new ForbiddenException('Hanya admin yang boleh mengalihkan job yang sedang dikerjakan atau menunggu review');
      }

      // Nama teknisi untuk catatan audit (detail audit dibaca manusia, bukan id).
      const nameOf = new Map(
        (
          await tx.user.findMany({
            where: { id: { in: [technicianId, ...targets.map((t) => t.technicianId).filter((x): x is string => !!x)] } },
            select: { id: true, displayName: true },
          })
        ).map((u) => [u.id, u.displayName]),
      );

      const now = new Date();
      const previousTechnicianIds = new Set<string>();
      let updatedBase = job;
      for (const t of targets) {
        // Saudara yang sudah dipegang teknisi yang sama (sedang jalan / menunggu review): tidak ada yang berubah.
        if (adminOnly.includes(t.status) && t.technicianId === technicianId) continue;
        const updated = await tx.technicianJob.update({
          where: { id: t.id },
          data: {
            technicianId,
            // Job yang sedang dikerjakan kembali ke 'assigned' (teknisi baru wajib scan ulang, start()). Job yang
            // menunggu review tetap menunggu review — pekerjaannya sudah selesai, admin tinggal menyetujui.
            status: t.status === TechnicianJobStatus.menunggu_review ? TechnicianJobStatus.menunggu_review : TechnicianJobStatus.assigned,
            updatedAt: now,
          },
        });
        if (t.id === jobId) updatedBase = updated;
        if (t.technicianId && t.technicianId !== technicianId) {
          previousTechnicianIds.add(t.technicianId);
          await tx.jobHandover.create({
            data: {
              jobId: t.id,
              fromTechnicianId: t.technicianId,
              toTechnicianId: technicianId,
              handedById: opts.actorId,
              statusAtHandover: t.status,
              reason,
            },
          });
          await tx.auditLog.create({
            data: {
              actorUid: opts.actorId,
              action: 'job.handover',
              target: t.id,
              detail: {
                dari: nameOf.get(t.technicianId) ?? t.technicianId,
                ke: nameOf.get(technicianId) ?? technicianId,
                statusAtHandover: t.status,
                reason,
              },
            },
          });
        }
      }
      return { ...updatedBase, previousTechnicianIds: [...previousTechnicianIds] };
    });
  }

  /**
   * Aksi "start" — gate: job harus 'assigned', scan barcode WAJIB cocok
   * dengan unit pada job ini.
   *
   * REVISI (dibalikin sesuai arahan user, konsep app mobile teknisi yang
   * lama itu yang benar): minimal 1 foto 'sebelum' WAJIB sudah ada sebelum
   * job bisa dimulai (rule 8.3 di app mobile lama — `hasBefore` ngunci
   * tombol "Mulai Pekerjaan"). Draft Siklus 5 revisi sempat mindahin gate
   * ini seluruhnya ke submitForReview dengan alasan "foto sekarang melekat
   * ke JobFinding, belum tentu ada temuan saat job baru mulai" — itu bukan
   * masalah nyata karena addFinding/addFindingPhoto SUDAH mengizinkan
   * status 'assigned' juga (bukan cuma 'sedang_dikerjakan'), jadi teknisi
   * tetap bisa nambah temuan + unggah foto sebelum SEBELUM start(). Gate di
   * submitForReview (per-temuan, sebelum DAN sesudah) tetap jalan seperti
   * biasa buat validasi akhir — ini gate TAMBAHAN yang lebih awal, bukan
   * gantinya.
   */
  async start(
    jobId: string,
    scannedBarcode: string,
    actorId: string,
    role: Role,
  ) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      include: { unit: { include: UNIT_PRODUCTS_SELECT } },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);

    if (job.status !== TechnicianJobStatus.assigned) {
      throw new BadRequestException(
        'Job harus berstatus Ditugaskan untuk dimulai',
      );
    }
    const beforePhotoCount = await this.prisma.jobFindingPhoto.count({
      where: { kind: 'sebelum', finding: { jobId } },
    });
    if (beforePhotoCount === 0) {
      throw new BadRequestException(
        'Unggah foto sebelum dulu (di salah satu temuan) sebelum memulai pekerjaan',
      );
    }
    if (!scannedBarcode?.trim()) {
      throw new BadRequestException(
        'Scan barcode unit diperlukan sebelum memulai',
      );
    }
    if (!job.unit || job.unit.barcodeValue !== scannedBarcode) {
      throw new BadRequestException('Barcode tidak sesuai unit pada job ini');
    }
    if (job.unit.status === 'menunggu_data') {
      throw new BadRequestException(
        'Data unit AC ini belum dilengkapi. Scan QR-nya di menu Scan Unit dan lengkapi merk/PK dulu.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: {
          status: TechnicianJobStatus.sedang_dikerjakan,
          // Job yang dialihkan ke teknisi lain saat sedang dikerjakan kembali ke 'assigned' (wajib scan ulang);
          // waktu mulai pertama tetap dipertahankan.
          startedAt: job.startedAt ?? new Date(),
          updatedAt: new Date(),
        },
      });
      if (job.orderId && job.unitId) {
        await tx.serviceOrderUnit.updateMany({
          where: { orderId: job.orderId, unitId: job.unitId },
          data: { status: 'dalam_pengerjaan' },
        });
      }
      if (job.unitId && job.type !== 'pemasangan') {
        // Unit yang lagi diinstal belum berstatus aktif; unit yang sudah aktif
        // dan sedang diservis (bukan instalasi baru) masuk 'dalam_maintenance'.
        await tx.memberAcUnit.update({
          where: { id: job.unitId },
          data: { status: 'dalam_maintenance' },
        });
      }
      return updated;
    });
  }

  /**
   * Tambah temuan masalah baru ke job yang sedang berjalan (Siklus 5
   * revisi). Isi salah satu categoryId (dari autocomplete) atau categoryName
   * (ketik bebas — auto-create kategori baru kalau belum ada). Bisa dipanggil
   * berkali-kali oleh teknisi selama job aktif — bukan cuma sekali di awal.
   */
  async addFinding(
    jobId: string,
    dto: { categoryId?: string; categoryName?: string; note?: string },
    actorId: string,
    role: Role,
  ) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    if (
      !(
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]
      ).includes(job.status)
    ) {
      throw new BadRequestException(
        'Temuan hanya bisa ditambahkan saat job aktif',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const category = await this.findOrCreateCategory(tx, dto);
      return tx.jobFinding.create({
        data: {
          jobId,
          categoryId: category.id,
          title: category.name,
          note: dto.note?.trim() || undefined,
          origin: 'ditambah_teknisi',
          createdById: actorId,
        },
        include: { category: true },
      });
    });
  }

  /** Deskripsi tambahan pada satu temuan (teknisi menjelaskan kondisi tiap unit). Selama job aktif; kosong = hapus. */
  async updateFindingNote(jobId: string, findingId: string, note: string, actorId: string, role: Role) {
    const job = await this.prisma.technicianJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    if (
      !([TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]).includes(job.status)
    ) {
      throw new BadRequestException('Deskripsi temuan hanya bisa diubah saat job aktif');
    }
    const finding = await this.prisma.jobFinding.findUnique({ where: { id: findingId } });
    if (!finding || finding.jobId !== jobId) {
      throw new NotFoundException('Temuan tidak ditemukan pada job ini');
    }
    return this.prisma.jobFinding.update({
      where: { id: findingId },
      data: { note: note.trim() || null },
    });
  }

  /** Upload foto sebelum/sesudah KE SATU TEMUAN tertentu — boleh dipanggil
   * berkali-kali per kind (tidak dibatasi 1 foto saja). */
  async addFindingPhoto(
    jobId: string,
    findingId: string,
    kind: 'sebelum' | 'sesudah',
    path: string,
    actorId: string,
    role: Role,
  ) {
    if (kind !== 'sebelum' && kind !== 'sesudah') {
      throw new BadRequestException("kind harus 'sebelum' atau 'sesudah'");
    }
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    if (
      !(
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]
      ).includes(job.status)
    ) {
      throw new BadRequestException(
        'Foto hanya bisa ditambahkan saat job aktif',
      );
    }
    const finding = await this.prisma.jobFinding.findUnique({
      where: { id: findingId },
    });
    if (!finding || finding.jobId !== jobId) {
      throw new NotFoundException('Temuan tidak ditemukan pada job ini');
    }

    return this.prisma.jobFindingPhoto.create({
      data: { findingId, kind, path, uploadedById: actorId },
    });
  }

  async updateNotes(jobId: string, notes: string, actorId: string, role: Role) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    // Sebelumnya gak ada guard status sama sekali — catatan job yang udah
    // 'selesai'/'dibatalkan' (closed, sudah lewat approveComplete) bisa
    // diubah diam-diam tanpa jejak, ngerusak audit trail histori job yang
    // seharusnya final. Konsisten sama gate di addFinding/addFindingPhoto.
    if (
      !(
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]
      ).includes(job.status)
    ) {
      throw new BadRequestException(
        'Catatan cuma bisa diubah selama job aktif',
      );
    }
    return this.prisma.technicianJob.update({
      where: { id: jobId },
      data: { notes },
    });
  }

  /**
   * Keterangan teknisi: catatan SATU ORDER untuk admin (mis. "Cuci 2 unit AC dibayar cash 75 ribu", "pelanggan minta penawaran
   * ganti kapasitor, bisa dikerjakan besok"), disimpan di service_orders.technician_note. BEDA dari updateNotes (Diagnosa /
   * Catatan Pengerjaan, per unit/job). `jobId` = job mana pun di order itu yang masih aktif dan milik pemanggil (admin: semua).
   */
  async updateKeterangan(jobId: string, keterangan: string, actorId: string, role: Role) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { id: true, orderId: true, technicianId: true, status: true },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);
    if (!([TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]).includes(job.status)) {
      throw new BadRequestException('Keterangan cuma bisa diubah selama job aktif');
    }
    const text = keterangan.trim() || null;
    await this.prisma.serviceOrder.update({ where: { id: job.orderId }, data: { technicianNote: text } });
    return { ok: true, orderId: job.orderId, technicianNote: text };
  }

  /**
   * "Kirim Temuan" (teknisi): menandai temuan sudah diinput, supaya kasir & admin
   * segera menetapkan tindakan + harga jasa. Notifikasi dikirim controller.
   * Boleh dikirim ulang (mis. setelah menambah temuan baru).
   */
  async sendFindings(jobId: string, actorId: string, role: Role) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({
        where: { id: jobId },
        include: {
          member: { select: { name: true } },
          technician: { select: { displayName: true } },
          findings: { select: { title: true, photos: { select: { kind: true } } } },
        },
      });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      this.assertOwnerOrAdmin(job, actorId, role);
      if (
        !(
          [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as TechnicianJobStatus[]
        ).includes(job.status)
      ) {
        throw new BadRequestException('Temuan hanya bisa dikirim selama job aktif');
      }
      // Job komplain tidak ditagih: tidak ada harga jasa yang perlu ditetapkan dari temuannya.
      if (job.complaintOfJobId) {
        throw new BadRequestException('Job komplain tidak ditagih, jadi temuannya tidak perlu dikirim untuk penetapan harga');
      }
      if (job.findings.length === 0) {
        throw new BadRequestException('Tambah minimal 1 temuan dulu sebelum dikirim');
      }
      // Kasir/admin menilai harga dari foto, jadi tiap temuan wajib punya foto SEBELUM dulu.
      const tanpaFoto = job.findings.filter((f) => !f.photos.some((p) => p.kind === 'sebelum'));
      if (tanpaFoto.length > 0) {
        throw new BadRequestException(
          `Isi foto sebelum dulu untuk temuan: ${tanpaFoto.map((f) => `"${f.title}"`).join(', ')}`,
        );
      }
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: { findingsSentAt: new Date() },
      });
      return {
        job: updated,
        findingCount: job.findings.length,
        customerName: job.member?.name ?? null,
        technicianName: job.technician?.displayName ?? null,
      };
    });
  }

  /**
   * Aksi "Ajukan Selesai" (teknisi) — pengganti sebagian peran complete()
   * lama. Gate: job harus 'sedang_dikerjakan', minimal 1 JobFinding ada,
   * SETIAP JobFinding minimal punya 1 foto 'sebelum' DAN 1 foto 'sesudah',
   * TIDAK ada material_request 'pending', dan yang 'approved' harus sudah
   * ditandai used. Transisi ke 'menunggu_review' — belum benar-benar
   * selesai, Admin masih harus approveComplete().
   */
  async submitForReview(
    jobId: string,
    actorId: string,
    role: Role,
    opts: { allInOrder?: boolean } = {},
  ) {
    // Servis banyak AC: satu tombol "Ajukan Selesai" untuk SELURUH job (semua unit di order ini), bukan per unit.
    if (opts.allInOrder) return this.submitOrderForReview(jobId, actorId, role);
    const updated = await this.prisma.$transaction((tx) => this.submitJobInTx(tx, jobId, actorId, role));
    // Kabari admin (lonceng web). Dipasang di servis, bukan controller, supaya
    // jalur offline (sync-batch) dari mobile juga ikut memberi tahu admin.
    if (role !== 'admin') void this.notifyAdminsReview(jobId).catch(() => undefined);
    return updated;
  }

  /**
   * Gate + transisi SATU job ke 'menunggu_review' (dipakai pengajuan satu job maupun seluruh order).
   *
   * Dibungkus $transaction + row lock di technician_jobs (FOR UPDATE) SEJAK
   * AWAL — sebelumnya cek "gak ada material request pending" dan update
   * status job dilakukan sebagai 2 langkah lepas, tanpa lock. Kalau di
   * antara keduanya ada material_add lain (mis. lewat sync-batch offline
   * dari device lain milik teknisi yang sama, atau retry) yang lolos cek
   * status job "masih sedang_dikerjakan" dan bikin request 'pending' baru,
   * job bisa kepindah ke 'menunggu_review' padahal invariant "gak ada
   * pending request" udah dilanggar. Lock di sini bikin
   * MaterialRequestsService.create() yang jalan bersamaan (dia sendiri
   * gak nge-lock job row) tetap AMAN karena urutan operasi DB — begitu tx
   * ini pegang lock & baca job.status, create() lain yang masih nunggu commit
   * sebelumnya (atau setelahnya) tetap konsisten dengan hasil akhir count
   * di bawah karena dihitung di dalam transaction yang sama, setelah lock.
   */
  private async submitJobInTx(tx: Prisma.TransactionClient, jobId: string, actorId: string, role: Role) {
    await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.technicianJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(job, actorId, role);

    if (job.status !== TechnicianJobStatus.sedang_dikerjakan) {
      throw new BadRequestException(
        'Job harus Sedang Dikerjakan untuk diajukan selesai',
      );
    }

    const findings = await tx.jobFinding.findMany({
      where: { jobId },
      include: { photos: true },
    });
    if (findings.length === 0) {
      throw new BadRequestException(
        'Minimal 1 temuan masalah harus diisi sebelum job bisa diajukan selesai',
      );
    }
    for (const finding of findings) {
      const hasBefore = finding.photos.some((p) => p.kind === 'sebelum');
      const hasAfter = finding.photos.some((p) => p.kind === 'sesudah');
      if (!hasBefore || !hasAfter) {
        throw new BadRequestException(
          `Temuan "${finding.title}" wajib punya foto SEBELUM dan SESUDAH sebelum job bisa diajukan selesai`,
        );
      }
    }

    const pendingRequests = await tx.materialRequest.count({
      where: { jobId, status: 'pending' },
    });
    if (pendingRequests > 0) {
      throw new BadRequestException(
        'Masih ada pengajuan tambahan yang belum diputuskan',
      );
    }
    // Harga jasa BUKAN syarat pengajuan: teknisi cukup melengkapi temuan + foto, lalu admin menetapkan harga jasa saat
    // review. Gate harga ada di approveComplete() (assertJobPriced).
    const unusedApproved = await tx.materialRequest.count({
      where: { jobId, status: 'approved', usedAt: null },
    });
    if (unusedApproved > 0) {
      throw new BadRequestException(
        'Tandai material yang disetujui sebagai dipakai sebelum mengajukan selesai',
      );
    }

    return tx.technicianJob.update({
      where: { id: jobId },
      // reviewNote dikosongkan lagi — kalau ini pengajuan ulang setelah
      // sebelumnya dikembalikan admin, catatan lama gak boleh nyangkut.
      data: {
        status: TechnicianJobStatus.menunggu_review,
        reviewNote: null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Gate harga jasa saat admin menyetujui selesai: servis mandiri baru punya invoice setelah harga jasanya ditetapkan
   * (order.invoiceId); tanpa ini servis selesai tanpa tagihan. Servis gratis/garansi = harga Rp 0 eksplisit.
   * Servis banyak AC memakai SATU invoice untuk semua unit, jadi "invoice ada" belum berarti unit INI sudah dihargai:
   * tiap unit harus punya harga jasanya sendiri (billingDerived). Order satu job dan pemasangan (invoice dari POS)
   * tidak terpengaruh. Status pembayaran SENGAJA tidak dicek: admin bebas menyelesaikan sebelum/sesudah lunas.
   */
  private async assertJobPriced(job: { id: string; orderId: string; type: string; billingDerived: boolean }) {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: job.orderId },
      select: { invoiceId: true },
    });
    if (order && !order.invoiceId) {
      throw new BadRequestException('Harga jasa belum ditetapkan. Tetapkan harga jasa dulu sebelum menyelesaikan pekerjaan.');
    }
    if (job.type !== 'pemasangan' && !job.billingDerived) {
      const siblingJobs = await this.prisma.technicianJob.count({
        where: { orderId: job.orderId, id: { not: job.id }, status: { not: TechnicianJobStatus.dibatalkan } },
      });
      if (siblingJobs > 0) {
        throw new BadRequestException('Harga jasa untuk unit ini belum ditetapkan. Tetapkan dulu sebelum menyelesaikan pekerjaan.');
      }
    }
  }

  /** Nama unit untuk pesan galat/notifikasi servis banyak AC. */
  private unitName(unit: { brand: string | null; model: string | null; roomLocation: string | null; barcodeValue: string } | null) {
    return unit ? unitInvoiceLabel(unit) : 'tanpa unit';
  }

  /**
   * "Ajukan Selesai" untuk SELURUH order servis banyak AC (semua unit sekaligus). Atomik: kalau satu unit belum
   * memenuhi gate (belum discan/dimulai, temuan/foto kurang, harga belum ditetapkan, dst), tidak ada unit yang
   * berubah dan pesannya menyebut unit mana. Unit yang sudah diajukan/selesai dilewati; unit dibatalkan diabaikan.
   */
  private async submitOrderForReview(jobId: string, actorId: string, role: Role) {
    const base = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: { orderId: true, technicianId: true },
    });
    if (!base) throw new NotFoundException('Job tidak ditemukan');
    this.assertOwnerOrAdmin(base, actorId, role);

    const { updated, count } = await this.prisma.$transaction(async (tx) => {
      // Kunci semua job order ini (urut id supaya dua pengajuan bersamaan tidak saling menunggu / deadlock).
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE order_id = ${base.orderId} ORDER BY id FOR UPDATE`;
      const jobs = await tx.technicianJob.findMany({
        where: { orderId: base.orderId, status: { not: TechnicianJobStatus.dibatalkan } },
        include: { unit: { select: { brand: true, model: true, roomLocation: true, barcodeValue: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const notStarted = jobs.filter(
        (j) => j.status === TechnicianJobStatus.menunggu_penugasan || j.status === TechnicianJobStatus.assigned,
      );
      if (notStarted.length > 0) {
        throw new BadRequestException(
          `Unit berikut belum discan/dimulai: ${notStarted.map((j) => this.unitName(j.unit)).join(', ')}. ` +
            'Semua unit harus discan dan dimulai sebelum diajukan selesai.',
        );
      }
      const toSubmit = jobs.filter((j) => j.status === TechnicianJobStatus.sedang_dikerjakan);
      if (toSubmit.length === 0) {
        throw new BadRequestException('Tidak ada unit yang bisa diajukan selesai (belum dimulai atau sudah diajukan).');
      }
      let target: { status: TechnicianJobStatus } | null = null;
      for (const j of toSubmit) {
        try {
          const result = await this.submitJobInTx(tx, j.id, actorId, role);
          if (j.id === jobId) target = result;
        } catch (e) {
          if (e instanceof BadRequestException) {
            throw new BadRequestException(`Unit ${this.unitName(j.unit)}: ${e.message}`);
          }
          throw e;
        }
      }
      const updated = target ?? (await tx.technicianJob.findUniqueOrThrow({ where: { id: jobId } }));
      return { updated, count: toSubmit.length };
    });
    // Satu notifikasi untuk seluruh order (bukan per unit).
    if (role !== 'admin') void this.notifyAdminsReview(jobId, count).catch(() => undefined);
    return updated;
  }

  /** Notifikasi ke semua admin: ada job menunggu review (`unitCount` > 1 = servis banyak AC, satu notifikasi). */
  private async notifyAdminsReview(jobId: string, unitCount = 1) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      select: {
        technician: { select: { displayName: true } },
        member: { select: { name: true } },
        unit: { select: { brand: true, roomLocation: true } },
      },
    });
    const unit = [job?.unit?.brand, job?.unit?.roomLocation].filter(Boolean).join(' · ');
    await this.notifications.notifyRoles(['admin'], {
      title: 'Job Menunggu Review',
      body:
        unitCount > 1
          ? `${job?.technician?.displayName ?? 'Teknisi'} mengajukan servis ${unitCount} unit AC${job?.member ? ` ${job.member.name}` : ''} untuk direview.`
          : `${job?.technician?.displayName ?? 'Teknisi'} mengajukan job${job?.member ? ` ${job.member.name}` : ''}${unit ? ` (${unit})` : ''} untuk direview.`,
      type: 'job_review',
      target: jobId,
    });
  }

  /**
   * Aksi "Setujui" (Admin only) — job harus 'menunggu_review'. Tidak ada
   * gate otomatis tambahan di sini: review visual Admin (liat foto tiap
   * temuan + data tambahan seperti sparepart) ITU SENDIRI yang jadi gate,
   * sesuai keputusan user. Efek samping identik dengan complete() lama.
   */
  async approveComplete(jobId: string, role: Role, dto: ApproveCompleteDto = {}) {
    if (role !== 'admin') {
      throw new ForbiddenException(
        'Hanya Admin yang boleh menyetujui penyelesaian job',
      );
    }
    // Servis banyak AC: satu persetujuan untuk SELURUH job (semua unit), bukan per unit.
    if (dto.allInOrder) return this.approveOrder(jobId, dto);
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (job.status !== TechnicianJobStatus.menunggu_review) {
      throw new BadRequestException(
        'Job harus berstatus Menunggu Review untuk disetujui',
      );
    }
    // Job komplain tidak ditagih lagi: tidak ada harga jasa yang perlu ditetapkan sebelum disetujui.
    if (!job.complaintOfJobId) await this.assertJobPriced(job);

    // Pengingat servis per unit AC (2026-09-30) — validasi SEBELUM transaksi
    // supaya job tidak tertutup kalau siklusnya belum diisi.
    const unitForSchedule = job.unitId
      ? await this.prisma.memberAcUnit.findUnique({
          where: { id: job.unitId },
          select: { serviceIntervalDays: true },
        })
      : null;
    const schedule = resolveApproveSchedule({
      jobType: job.type,
      reminderEnabled: dto.reminderEnabled,
      serviceIntervalDays: dto.serviceIntervalDays,
      unitIntervalDays: unitForSchedule?.serviceIntervalDays ?? null,
    });

    let pendingWaLogId: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: { status: TechnicianJobStatus.selesai, completedAt: now, updatedAt: now },
      });

      if (job.orderId && job.unitId) {
        await tx.serviceOrderUnit.updateMany({
          where: { orderId: job.orderId, unitId: job.unitId },
          data: { status: 'selesai' },
        });
      }
      if (job.unitId) {
        // Pengingat servis per unit AC (2026-09-30) — 1 unit = 1 set AC
        // (indoor+outdoor). Hanya cuci/maintenance/pemasangan yang mengatur
        // ulang jadwal; jenis job lain (perbaikan dst) TIDAK menyentuh
        // nextServiceDate/siklus/saklar (dulu malah mengosongkannya).
        const unitData: Prisma.MemberAcUnitUpdateInput = {
          status: job.type === 'pemasangan' ? 'aktif' : undefined,
          installationDate: job.type === 'pemasangan' ? now : undefined,
        };
        let nextService: Date | null = null;
        if (schedule.touch) {
          unitData.lastServiceDate = now;
          if (schedule.enabled) {
            nextService = addDays(now, schedule.intervalDays);
            unitData.reminderEnabled = true;
            unitData.serviceIntervalDays = schedule.intervalDays;
            unitData.nextServiceDate = nextService;
          } else {
            unitData.reminderEnabled = false;
            unitData.nextServiceDate = null;
          }
        }

        const updatedUnit = await tx.memberAcUnit.update({
          where: { id: job.unitId },
          data: unitData,
        });

        // start() menaruh unit di 'dalam_maintenance' selama job non-pemasangan jalan; kembalikan ke
        // 'aktif' di sini (semua jenis job, bukan hanya yang mengatur jadwal), kalau tidak cron
        // pengingat (hanya unit 'aktif') melewati unit ini selamanya.
        await releaseUnitMaintenanceTx(tx, job.unitId, jobId);

        if (schedule.touch && !schedule.enabled) {
          await this.reminders.cancelPendingForUnitTx(tx, job.unitId, 'Pengingat unit dimatikan');
        }

        // Pesan "pekerjaan selesai" — cuma diantre kalau pengingat nyala dan
        // ada jadwal berikutnya. Cuma dibuat baris 'pending' DI SINI (dalam
        // transaksi); provider WA beneran dipanggil SETELAH transaksi ini
        // commit biar gak nahan lock Postgres sambil nunggu network I/O.
        if (schedule.touch && schedule.enabled && nextService) {
          const log = await this.reminders.enqueueJobCompleteMessageTx(tx, {
            jobId,
            memberId: updatedUnit.memberId,
            unitId: job.unitId,
            dueDate: nextService,
          });
          pendingWaLogId = log?.id ?? null;
        }
      }
      if (job.orderId) {
        // Lock row service_orders DULU — kalau 2 job dalam 1 ServiceOrder
        // yang sama diselesaikan admin nyaris bersamaan, tanpa lock ini
        // masing-masing transaction bisa baca stillOpen>0 (nganggep job yang
        // LAIN masih "buka" dari snapshot sebelum transaksi lain commit),
        // jadi DUA-duanya gak ada yang nge-set status 'selesai' walau
        // sebenarnya kedua job udah beres.
        await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${job.orderId} FOR UPDATE`;
        const stillOpen = await tx.technicianJob.count({
          where: {
            orderId: job.orderId,
            status: {
              notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan],
            },
          },
        });
        if (stillOpen === 0) {
          await tx.serviceOrder.update({
            where: { id: job.orderId },
            data: { status: 'selesai' },
          });
        }
      }
      return updated;
    });

    if (pendingWaLogId) {
      // SETELAH transaksi commit — kirim WA beneran lewat Fonnte. Dibungkus
      // try/catch di sini juga (WhatsappService.sendPendingLog sendiri
      // udah gak pernah throw utk kegagalan Fonnte, catch ini cuma jaring
      // pengaman ekstra utk error tak terduga lain) supaya gagal kirim WA
      // TIDAK PERNAH bikin approveComplete() ini gagal — job udah telanjur
      // 'selesai', itu yang penting buat teknisi/admin, notifikasi WA cuma
      // bonus.
      try {
        await this.whatsapp.sendPendingLog(pendingWaLogId);
      } catch (e) {
        this.logger.warn(
          `Gagal kirim WA konfirmasi selesai servis (log ${pendingWaLogId}): ${e}`,
        );
      }
    }

    return result;
  }

  /**
   * "Setujui Selesai" untuk SELURUH order servis banyak AC (semua unit yang menunggu review sekaligus). Syarat: tidak
   * ada unit yang masih dikerjakan (belum diajukan). Jadwal pengingat (job cuci/maintenance/pemasangan) divalidasi
   * untuk SEMUA unit lebih dulu supaya tidak ada unit yang tertutup separuh karena unit lain belum diisi siklusnya;
   * tiap unit lalu disetujui seperti biasa (status unit, riwayat servis, pesan WA per unit).
   */
  private async approveOrder(jobId: string, dto: ApproveCompleteDto) {
    const base = await this.prisma.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
    if (!base) throw new NotFoundException('Job tidak ditemukan');
    const jobs = await this.prisma.technicianJob.findMany({
      where: { orderId: base.orderId, status: { not: TechnicianJobStatus.dibatalkan } },
      include: {
        unit: { select: { brand: true, model: true, roomLocation: true, barcodeValue: true, serviceIntervalDays: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const waiting = jobs.filter((j) => j.status === TechnicianJobStatus.menunggu_review);
    const inProgress = jobs.filter(
      (j) => j.status !== TechnicianJobStatus.menunggu_review && j.status !== TechnicianJobStatus.selesai,
    );
    if (inProgress.length > 0) {
      throw new BadRequestException(
        `Masih ada unit yang belum diajukan selesai: ${inProgress.map((j) => this.unitName(j.unit)).join(', ')}.`,
      );
    }
    if (waiting.length === 0) {
      throw new BadRequestException('Tidak ada unit yang menunggu review untuk disetujui');
    }

    // Jadwal pengingat per unit (units[]); yang tidak disebut memakai nilai tingkat atas.
    const own = new Map((dto.units ?? []).map((u) => [u.jobId, u]));
    const plan: { job: (typeof waiting)[number]; unitDto: ApproveCompleteDto }[] = [];
    for (const j of waiting) {
      // Harga jasa tiap unit harus sudah ditetapkan (dicek untuk SEMUA unit dulu supaya tidak setengah tersetujui).
      try {
        if (!j.complaintOfJobId) await this.assertJobPriced(j); // job komplain tidak ditagih
      } catch (e) {
        if (e instanceof BadRequestException) {
          throw new BadRequestException(`Unit ${this.unitName(j.unit)}: ${e.message}`);
        }
        throw e;
      }
      const s = own.get(j.id);
      const unitDto: ApproveCompleteDto = {
        reminderEnabled: s?.reminderEnabled ?? dto.reminderEnabled,
        serviceIntervalDays: s?.serviceIntervalDays ?? dto.serviceIntervalDays,
      };
      try {
        resolveApproveSchedule({ jobType: j.type, ...unitDto, unitIntervalDays: j.unit?.serviceIntervalDays ?? null });
      } catch (e) {
        if (e instanceof BadRequestException) {
          throw new BadRequestException(`Unit ${this.unitName(j.unit)}: ${e.message}`);
        }
        throw e;
      }
      plan.push({ job: j, unitDto });
    }
    for (const { job, unitDto } of plan) {
      try {
        await this.approveComplete(job.id, 'admin', unitDto);
      } catch (e) {
        if (e instanceof BadRequestException) {
          throw new BadRequestException(`Unit ${this.unitName(job.unit)}: ${e.message}`);
        }
        throw e;
      }
    }
    return this.prisma.technicianJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /**
   * Aksi "Kembalikan ke Teknisi" (Admin only) — dipakai kalau hasil review
   * belum memuaskan. Job kembali 'sedang_dikerjakan' dengan catatan wajib
   * (reviewNote) supaya teknisi tau apa yang harus dibenerin/dilengkapi
   * sebelum mengajukan selesai lagi.
   */
  async sendBack(jobId: string, note: string, role: Role, opts: { allInOrder?: boolean } = {}) {
    if (role !== 'admin') {
      throw new ForbiddenException(
        'Hanya Admin yang boleh mengembalikan job ke teknisi',
      );
    }
    if (!note?.trim()) {
      throw new BadRequestException(
        'Catatan wajib diisi saat mengembalikan job ke teknisi',
      );
    }
    // Servis banyak AC: seluruh job dikembalikan bersama (semua unit yang menunggu review), catatan menyebut unitnya.
    if (opts.allInOrder) {
      const base = await this.prisma.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      const moved = await this.prisma.technicianJob.updateMany({
        where: { orderId: base.orderId, status: TechnicianJobStatus.menunggu_review },
        data: { status: TechnicianJobStatus.sedang_dikerjakan, reviewNote: note.trim(), updatedAt: new Date() },
      });
      if (moved.count === 0) {
        throw new BadRequestException('Tidak ada unit yang menunggu review untuk dikembalikan');
      }
      return this.prisma.technicianJob.findUniqueOrThrow({ where: { id: jobId } });
    }
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (job.status !== TechnicianJobStatus.menunggu_review) {
      throw new BadRequestException(
        'Job harus berstatus Menunggu Review untuk dikembalikan',
      );
    }

    return this.prisma.technicianJob.update({
      where: { id: jobId },
      data: {
        status: TechnicianJobStatus.sedang_dikerjakan,
        reviewNote: note.trim(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Hanya admin, dan job yang sudah selesai tidak bisa dibatalkan.
   *
   * Fix dari audit: sebelumnya cancel() gak nyentuh MaterialRequest sama
   * sekali — pengajuan 'pending' bisa masih di-approve admin lain BELAKANGAN
   * (nge-charge customer buat sparepart yang gak akan pernah dipasang), dan
   * pengajuan 'approved' yang belum dipakai (usedAt null) — yang UDAH
   * nambah grandTotal invoice sejak di-approve, lihat decide() — bakal
   * nyangkut nagih customer selamanya walau job-nya batal. Sekarang di sini:
   * (1) pending -> ditolak otomatis, (2) approved-belum-dipakai -> tagihan
   * DIBALIKIN (invoice adjustment negatif) + status diubah jadi 'dibatalkan'
   * (BUKAN 'rejected' lagi, biar beda jelas sama "ditolak sebelum sempat
   * disetujui" — dan otomatis gak lolos guard markUsed() yang mensyaratkan
   * status 'approved').
   */
  async cancel(jobId: string, actorId: string, role: Role, opts: { moveRequestsToSibling?: boolean } = {}) {
    if (role !== 'admin') {
      throw new ForbiddenException('Hanya Admin yang boleh membatalkan job');
    }
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (job.status === TechnicianJobStatus.selesai) {
      throw new BadRequestException(
        'Job yang sudah selesai tidak bisa dibatalkan',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: { status: TechnicianJobStatus.dibatalkan, updatedAt: now },
      });
      if (job.orderId && job.unitId) {
        await tx.serviceOrderUnit.updateMany({
          where: { orderId: job.orderId, unitId: job.unitId },
          data: { status: 'dibatalkan' },
        });
      }
      // Job dibatalkan = unit tidak lagi diservis; kembalikan dari 'dalam_maintenance' (kalau tak ada job lain).
      if (job.unitId) await releaseUnitMaintenanceTx(tx, job.unitId, jobId);

      // Servis banyak AC (halaman web satu job): pengajuan sparepart dipakai bersama seluruh unit dan melekat pada
      // salah satu unit. Kalau unit yang dibatalkan memegangnya dan masih ada unit lain yang aktif, pengajuan
      // DIPINDAH ke unit aktif berikutnya, bukan ikut ditolak/dibatalkan. Hanya bila diminta (flag), dan tidak untuk
      // pemasangan POS, supaya alur per-job (app mobile) tidak berubah.
      //
      // Harga jasa servis banyak AC juga SATU untuk seluruh job dan disimpan di job pemegang harga (job pertama yang
      // belum dibatalkan). Kalau unit yang dibatalkan pemegangnya, baris jasa + transport DIPINDAH ke unit aktif
      // berikutnya (selalu, tanpa menunggu flag) supaya tagihan tidak ikut hilang.
      let successor: { id: string; billingDerived: boolean } | null = null;
      if (job.type !== 'pemasangan') {
        const holdsPricing = job.transportLevel > 0 || (await tx.jobServiceLine.count({ where: { jobId } })) > 0;
        if (opts.moveRequestsToSibling || holdsPricing) {
          successor = await tx.technicianJob.findFirst({
            where: {
              orderId: job.orderId,
              id: { not: jobId },
              status: { notIn: [TechnicianJobStatus.dibatalkan, TechnicianJobStatus.selesai] },
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true, billingDerived: true },
          });
          if (successor) {
            if (opts.moveRequestsToSibling) {
              await tx.materialRequest.updateMany({ where: { jobId }, data: { jobId: successor.id } });
            }
            // Pengganti yang sudah punya baris jasa sendiri (data lama per unit) dibiarkan: baris job yang dibatalkan
            // hilang dari tagihan lewat rebuild() di bawah.
            if (holdsPricing && (await tx.jobServiceLine.count({ where: { jobId: successor.id } })) === 0) {
              await tx.jobServiceLine.updateMany({ where: { jobId }, data: { jobId: successor.id } });
              await tx.technicianJob.update({
                where: { id: successor.id },
                data: { billingDerived: true, transportLevel: job.transportLevel, transportMode: job.transportMode },
              });
              await tx.technicianJob.update({ where: { id: jobId }, data: { transportLevel: 0 } });
              successor = { id: successor.id, billingDerived: true };
            }
          }
        }
      }

      // (1) Pengajuan yang masih 'pending' — belum pernah nyentuh invoice
      // sama sekali (decide() yang nambah tagihan, bukan create()), jadi
      // cukup ganti status, gak ada duit yang perlu dibalikin.
      await tx.materialRequest.updateMany({
        where: { jobId, status: 'pending' },
        data: {
          status: 'rejected',
          decidedById: actorId,
          decidedAt: now,
          decisionNote: 'Ditolak otomatis — job dibatalkan',
        },
      });

      // (2) Pengajuan 'approved' TAPI belum dipakai — udah nambah grandTotal
      // invoice waktu di-approve (decide()), jadi harus DIBALIKIN di sini,
      // bukan cuma diganti statusnya doang.
      const approvedUnused = await tx.materialRequest.findMany({
        where: { jobId, status: 'approved', usedAt: null },
      });
      for (const req of approvedUnused) {
        // Hanya pengajuan yang ditagih lewat penyesuaian (jalur lama) yang perlu dibalikkan di sini;
        // yang ditagih lewat baris job dihapus oleh rebuild() di bawah.
        const billedByAdjustment = (await tx.invoiceAdjustment.count({ where: { requestId: req.id } })) > 0;
        if (req.invoiceId && billedByAdjustment) {
          // Lock invoice row-nya dulu (pola sama kayak decide()/PaymentsService)
          // sebelum baca+update grandTotal, biar gak nubruk pembayaran/pengajuan
          // lain yang lagi jalan bersamaan di invoice yang sama.
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
          >`SELECT id, grand_total, total_paid, status FROM invoices WHERE id = ${req.invoiceId} FOR UPDATE`;
          const inv = rows[0];
          if (inv) {
            const requestTotal = Number(req.total);
            const newGrand = Number(inv.grand_total) - requestTotal;
            await tx.invoiceAdjustment.create({
              data: {
                invoiceId: req.invoiceId,
                requestId: req.id,
                amount: -requestTotal,
                reason: 'pembatalan_job',
                createdById: actorId,
              },
            });
            const newStatus = computeInvoiceStatus(
              newGrand,
              Number(inv.total_paid),
              inv.status,
            );
            await tx.invoice.update({
              where: { id: req.invoiceId },
              data: { grandTotal: newGrand, status: newStatus },
            });
          }
        }
        await tx.materialRequest.update({
          where: { id: req.id },
          data: {
            status: 'dibatalkan',
            decidedAt: now,
            decisionNote:
              'Dibatalkan otomatis — job dibatalkan sebelum material dipakai, tagihan dibalikin',
          },
        });
      }

      // Tagihan job yang dihitung ulang: job dibatalkan -> semua baris job ini dihapus dari invoice.
      if (job.billingDerived) await this.jobBilling.rebuild(tx, jobId, actorId);
      // Pengajuan yang dipindah ikut ditagihkan lewat baris unit penggantinya (kalau sudah dihargai; kalau belum,
      // masuk begitu harga unit itu ditetapkan — pengajuan satu job wajib dihargai semua unitnya sebelum selesai).
      if (successor?.billingDerived) await this.jobBilling.rebuild(tx, successor.id, actorId);

      return updated;
    });
  }
}
