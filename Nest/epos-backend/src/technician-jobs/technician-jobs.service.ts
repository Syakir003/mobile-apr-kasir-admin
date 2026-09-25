import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  ProblemCategory,
} from '@prisma/client';
import { TechnicianJobStatus } from '../common/technician-job-status';
import { PrismaService } from '../prisma/prisma.service';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { wibDayRange } from '../common/wib-date.util';
import { SupabaseRpcService, RpcActor } from '../prisma/supabase-rpc.service';

type Role = 'admin' | 'kasir' | 'teknisi';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly rpc: SupabaseRpcService,
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
  async myQueue(technicianId: string) {
    const jobs = await this.prisma.technicianJob.findMany({
      where: {
        technicianId,
        status: { in: [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] },
      },
      include: {
        member: true,
        unit: true,
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
        unit: true,
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
  /**
   * `unitId` = riwayat servis satu unit AC (dipakai mobile, semua peran).
   * Tanpa `unitId`, listing semua job cuma buat admin/kasir (dijaga
   * controller) — teknisi WAJIB isi `unitId`, dan hanya kebagian hasil kalau
   * dia sendiri punya minimal 1 job di unit itu. Port dari RLS
   * `my_visible_job_ids()` (migrasi 20260806000020): teknisi boleh lihat
   * job MILIKNYA + job teknisi lain pada UNIT yang sama, all-or-nothing per
   * unit (bukan per baris job).
   */
  async findAll(status?: TechnicianJobStatus, unitId?: string, actor?: { sub: string; role: Role }) {
    if (actor?.role === 'teknisi') {
      if (!unitId) {
        throw new ForbiddenException('Teknisi wajib menyertakan unitId');
      }
      const ownJobOnUnit = await this.prisma.technicianJob.count({
        where: { unitId, technicianId: actor.sub },
      });
      if (ownJobOnUnit === 0) return [];
    }

    return this.prisma.technicianJob.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(unitId ? { unitId } : {}),
      },
      include: {
        member: true,
        unit: true,
        technician: { select: { id: true, displayName: true, email: true } },
        order: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ringkasan foto & material untuk BANYAK job sekaligus (layar riwayat servis
   * per unit di mobile) — dua `groupBy`, bukan N query per job.
   *
   * RBAC di-port PERSIS dari RLS (migrasi 20260806000020), BUKAN dipercaya
   * dari `jobIds` kiriman client (endpoint ini berdiri sendiri, bukan cuma
   * dipanggil sesudah findAll):
   *  - job_photos: teknisi cuma lihat job VISIBLE (miliknya + job lain pada
   *    unit yang sama) — `my_visible_job_ids()`.
   *  - material_requests: teknisi cuma lihat job MILIKNYA — lebih ketat
   *    karena isinya nilai rupiah — `my_job_scope()`.
   * admin/kasir: tanpa batasan, sama seperti RLS mereka.
   */
  async historyExtras(jobIds: string[], actor: { sub: string; role: Role }) {
    const ids = [...new Set(jobIds)].slice(0, 300);
    const empty = () => ({
      photosBefore: 0,
      photosAfter: 0,
      materialItems: 0,
      materialTotal: 0,
      materialPending: 0,
    });
    const result: Record<string, ReturnType<typeof empty>> = {};
    for (const id of ids) result[id] = empty();
    if (ids.length === 0) return result;

    let photoIds = ids;
    let materialIds = ids;
    if (actor.role === 'teknisi') {
      const own = await this.prisma.technicianJob.findMany({
        where: { technicianId: actor.sub },
        select: { id: true, unitId: true },
      });
      const ownIds = new Set(own.map((j) => j.id));
      const ownUnitIds = new Set(own.map((j) => j.unitId).filter((u): u is string => !!u));
      materialIds = ids.filter((id) => ownIds.has(id));
      if (ownUnitIds.size === 0) {
        photoIds = ids.filter((id) => ownIds.has(id));
      } else {
        const candidates = ids.filter((id) => !ownIds.has(id));
        const jobs = candidates.length
          ? await this.prisma.technicianJob.findMany({
              where: { id: { in: candidates } },
              select: { id: true, unitId: true },
            })
          : [];
        const visibleOthers = new Set(
          jobs.filter((j) => j.unitId && ownUnitIds.has(j.unitId)).map((j) => j.id),
        );
        photoIds = ids.filter((id) => ownIds.has(id) || visibleOthers.has(id));
      }
    }

    const [photoRows, materialRows] = await Promise.all([
      photoIds.length
        ? this.prisma.jobPhoto.groupBy({
            by: ['jobId', 'kind'],
            where: { jobId: { in: photoIds } },
            _count: { _all: true },
          })
        : [],
      materialIds.length
        ? this.prisma.materialRequest.groupBy({
            by: ['jobId', 'status'],
            where: { jobId: { in: materialIds } },
            _count: { _all: true },
            _sum: { total: true },
          })
        : [],
    ]);

    for (const r of photoRows) {
      const entry = result[r.jobId];
      if (!entry) continue;
      if (r.kind === 'sesudah') entry.photosAfter += r._count._all;
      else entry.photosBefore += r._count._all;
    }
    for (const r of materialRows) {
      const entry = result[r.jobId];
      if (!entry) continue;
      if (r.status === 'approved') {
        entry.materialItems += r._count._all;
        entry.materialTotal += r._sum.total ?? 0;
      } else if (r.status === 'pending') {
        entry.materialPending += r._count._all;
      }
    }
    return result;
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
        unit: true,
        technician: { select: { id: true, displayName: true, email: true } },
        // invoice di-nest di sini (bukan order:true polos) biar teknisi di
        // lapangan bisa liat status bayar customer tanpa call endpoint
        // terpisah — "job payment information".
        order: {
          include: {
            invoice: { select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true } },
          },
        },
        photos: { orderBy: { createdAt: 'asc' } }, // model lama, cuma keisi utk job pra-migrasi
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
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (role === 'teknisi' && job.technicianId !== actorId) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    return job;
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
   * Riwayat job selesai milik teknisi yang login (Siklus 2). technicianId
   * WAJIB dari JWT `sub`, bukan query param — sama seperti myQueue() di atas,
   * biar teknisi A gak bisa liat riwayat teknisi B.
   */
  async history(technicianId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.technicianJob.findMany({
        where: { technicianId, status: TechnicianJobStatus.selesai },
        include: { member: true, unit: true, order: true },
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

  /** Admin/kasir menugaskan atau memindah-tugaskan teknisi (Task 5.1). */
  async assign(jobId: string, technicianId: string) {
    const technician = await this.prisma.user.findUnique({
      where: { id: technicianId },
    });
    if (!technician || technician.role !== 'teknisi' || !technician.active) {
      throw new BadRequestException('Teknisi tidak valid atau tidak aktif');
    }
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    // Sebelumnya gak ada guard sama sekali — job yang udah 'selesai' atau
    // 'dibatalkan' bisa di-assign ulang dan status-nya kereset jadi
    // 'assigned', "hidup lagi" padahal harusnya udah final. Reassign cuma
    // masuk akal selama job belum mulai dikerjakan (ganti teknisi sebelum
    // dia turun ke lapangan).
    if (
      !(
        [TechnicianJobStatus.menunggu_penugasan, TechnicianJobStatus.assigned] as string[]
      ).includes(job.status)
    ) {
      throw new BadRequestException(
        'Job yang sudah dikerjakan/menunggu review/selesai/dibatalkan tidak bisa di-assign ulang',
      );
    }

    return this.prisma.technicianJob.update({
      where: { id: jobId },
      data: { technicianId, status: TechnicianJobStatus.assigned, updatedAt: new Date() },
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
      include: { unit: true },
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.technicianJob.update({
        where: { id: jobId },
        data: {
          status: TechnicianJobStatus.sedang_dikerjakan,
          startedAt: new Date(),
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
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as string[]
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
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as string[]
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

  /** Model LAMA level-job (tabel `job_photos`, tanpa temuan) — port dari RPC
   * Postgres `add_job_photo`. Ditambahkan (bukan dihapus) untuk kompatibilitas
   * app mobile Flutter yang belum migrasi ke checklist temuan; guard SAMA
   * persis dengan addFindingPhoto()/RPC lama: pemilik atau admin, status job
   * aktif (assigned/sedang_dikerjakan), kind sebelum/sesudah. */
  async addJobPhoto(
    jobId: string,
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
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as string[]
      ).includes(job.status)
    ) {
      throw new BadRequestException(
        'Foto hanya bisa ditambahkan saat job aktif',
      );
    }

    return this.prisma.jobPhoto.create({
      data: { jobId, kind, path, uploadedById: actorId },
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
        [TechnicianJobStatus.assigned, TechnicianJobStatus.sedang_dikerjakan] as string[]
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
   * Aksi "Ajukan Selesai" (teknisi) — pengganti sebagian peran complete()
   * lama. Gate: job harus 'sedang_dikerjakan', minimal 1 JobFinding ada,
   * SETIAP JobFinding minimal punya 1 foto 'sebelum' DAN 1 foto 'sesudah',
   * TIDAK ada material_request 'pending', dan yang 'approved' harus sudah
   * ditandai used. Transisi ke 'menunggu_review' — belum benar-benar
   * selesai, Admin masih harus approveComplete().
   */
  async submitForReview(jobId: string, actorId: string, role: Role) {
    // Dibungkus $transaction + row lock di technician_jobs (FOR UPDATE) SEJAK
    // AWAL — sebelumnya cek "gak ada material request pending" dan update
    // status job dilakukan sebagai 2 langkah lepas, tanpa lock. Kalau di
    // antara keduanya ada material_add lain (mis. lewat sync-batch offline
    // dari device lain milik teknisi yang sama, atau retry) yang lolos cek
    // status job "masih sedang_dikerjakan" dan bikin request 'pending' baru,
    // job bisa kepindah ke 'menunggu_review' padahal invariant "gak ada
    // pending request" udah dilanggar. Lock di sini bikin
    // MaterialRequestsService.create() yang jalan bersamaan (dia sendiri
    // gak nge-lock job row) tetap AMAN karena urutan operasi DB — begitu tx
    // ini pegang lock & baca job.status, create() lain yang masih nunggu commit
    // sebelumnya (atau setelahnya) tetap konsisten dengan hasil akhir count
    // di bawah karena dihitung di dalam transaction yang sama, setelah lock.
    return this.prisma.$transaction(async (tx) => {
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
    });
  }

  /**
   * Aksi "Setujui" (Admin only) — job harus 'menunggu_review'. Tidak ada
   * gate otomatis tambahan di sini: review visual Admin (liat foto tiap
   * temuan + data tambahan seperti sparepart) ITU SENDIRI yang jadi gate,
   * sesuai keputusan user.
   *
   * Dulu ini raw Prisma (update job + unit + insert log WA lewat
   * RemindersService, lalu kirim Fonnte manual). Sekarang delegasi penuh ke
   * RPC `update_technician_job_status` action='approve' (redefinisi final
   * di migrasi 20260918000034_checklist_servis_review.sql) — RPC itu SUDAH
   * melakukan semuanya dalam satu transaksi atomik: cek role/status,
   * tandai job selesai, tutup service_order_units/service_orders, resolusi
   * siklus servis berikutnya, dan mengantre baris wa_outbox 'selesai_servis'
   * (dedupe_key `job:<id>`) — Nest tidak pernah mengirim WA sendiri, baris
   * itu menunggu admin/kasir kirim manual lewat layar Pengingat. Satu
   * implementasi, tidak ada logika ganda (lihat header SupabaseRpcService).
   */
  approveComplete(jobId: string, actor: RpcActor) {
    return this.rpc.call<{ ok: boolean; status: string }>(
      actor,
      'update_technician_job_status',
      { jobId, action: 'approve' },
    );
  }

  /**
   * Aksi "Kembalikan ke Teknisi" (Admin only) — dipakai kalau hasil review
   * belum memuaskan. Job kembali 'sedang_dikerjakan' dengan catatan wajib
   * (reviewNote) supaya teknisi tau apa yang harus dibenerin/dilengkapi
   * sebelum mengajukan selesai lagi.
   */
  async sendBack(jobId: string, note: string, role: Role) {
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
  async cancel(jobId: string, actorId: string, role: Role) {
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
        if (req.invoiceId) {
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

      return updated;
    });
  }
}
