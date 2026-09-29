import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';

// Whitelist ekstensi foto — dicocokkan dari mimetype yang beneran dideteksi
// multer (bukan dari nama file client, yang gampang dipalsu). Nama file
// FINAL selalu di-generate server (randomUUID), TIDAK PERNAH pakai
// file.originalname mentah — cegah path traversal (mis. originalname
// "../../../../src/main.js") yang sebelumnya bisa nembus destination folder
// lewat path.join di multer diskStorage.
const ALLOWED_PHOTO_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { TechnicianJobsService } from './technician-jobs.service';
import { AssignJobDto } from './dto/assign-job.dto';
import { StartJobDto } from './dto/start-job.dto';
import { UpdateNotesDto } from './dto/update-notes.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { FindAllJobsQueryDto } from './dto/find-all-jobs-query.dto';
import { AddFindingDto } from './dto/add-finding.dto';
import { SendBackDto } from './dto/send-back.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { SyncBatchDto } from './dto/sync-batch.dto';
import { OfflineSyncService } from './offline-sync.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('technician-jobs')
export class TechnicianJobsController {
  constructor(
    private readonly jobs: TechnicianJobsService,
    private readonly realtime: RealtimeGateway,
    private readonly offlineSync: OfflineSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  // technicianId diambil dari JWT `sub`, BUKAN dari query param — biar
  // teknisi A gak bisa liat antrian teknisi B.
  @Roles('teknisi')
  @Get('queue')
  myQueue(@CurrentUser() user: CurrentUserPayload) {
    return this.jobs.myQueue(user.sub);
  }

  // Siklus 9 (Mode Offline Teknisi) — payload gemuk buat precache harian
  // sebelum teknisi berangkat (belum tentu ada sinyal di lokasi servis).
  // Route 2-segment ('queue/today-bundle') gak bentrok sama ':id' di bawah
  // (beda jumlah segment), tapi tetap ditaruh di dekat 'queue' biar
  // konsisten sama pola "route statis di atas" di controller ini.
  @Roles('teknisi')
  @Get('queue/today-bundle')
  todayBundle(@CurrentUser() user: CurrentUserPayload) {
    return this.jobs.todayBundle(user.sub);
  }

  // Siklus 9 — terima array aksi offline (checklist temuan/material/catatan/
  // ajukan-selesai) yang numpuk pas teknisi gak ada sinyal, diproses satu-satu
  // & idempoten (aman di-retry seluruh batch). Lihat OfflineSyncService.
  @Roles('teknisi')
  @Post('sync-batch')
  syncBatch(
    @Body() dto: SyncBatchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.offlineSync.processSyncBatch(dto.actions, user.sub);
  }

  // Ditambahkan buat frontend uji-coba: admin/kasir belum punya cara lihat
  // semua job (RPC asli gak pernah butuh, Flutter admin query Supabase langsung).
  @Roles('admin', 'kasir')
  @Get()
  findAll(@Query() query: FindAllJobsQueryDto) {
    return this.jobs.findAll(query.status);
  }

  // Siklus 2 (Servis Masuk Mandiri). Route statis 'history' WAJIB didaftarkan
  // sebelum ':id' di bawah, biar Nest gak nyangka 'history' itu value :id.
  @Roles('teknisi')
  @Get('history')
  history(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: HistoryQueryDto,
  ) {
    return this.jobs.history(user.sub, query.page ?? 1, query.pageSize ?? 20);
  }

  // Siklus 5 (revisi) — autocomplete kategori temuan. Route statis
  // 'categories/search' juga WAJIB sebelum ':id', sama alasannya kayak 'history'.
  @Roles('admin', 'teknisi')
  @Get('categories/search')
  searchCategories(@Query('q') q?: string) {
    return this.jobs.searchCategories(q ?? '');
  }

  // Admin nambah kategori baku secara manual, di luar flow auto-create yang
  // kejadian otomatis lewat POST :id/findings saat teknisi ngetik bebas.
  @Roles('admin')
  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.jobs.createCategory(dto.name);
  }

  @Roles('admin', 'kasir', 'teknisi')
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.jobs.findOne(id, user.sub, user.role);
  }

  @Roles('admin', 'kasir')
  @Patch(':id/assign')
  async assign(@Param('id') id: string, @Body() dto: AssignJobDto) {
    const result = await this.jobs.assign(id, dto.technicianId);
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    // Notifikasi push ke teknisi yang baru ditugaskan — .catch() biar
    // gagal kirim notifikasi (mis. push FCM error) gak nge-throw balik ke
    // response assign() yang aksi utamanya udah sukses & ke-commit (sama
    // pola kayak MaterialRequestsController.decide()).
    this.notifications
      .notify(dto.technicianId, {
        title: 'Job Baru Ditugaskan',
        body: 'Kamu dapat penugasan job servis baru.',
        type: 'job_assigned',
        target: id,
      })
      .catch(() => {});
    return result;
  }

  @Roles('admin', 'teknisi')
  @Patch(':id/start')
  async start(
    @Param('id') id: string,
    @Body() dto: StartJobDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.jobs.start(
      id,
      dto.scannedBarcode,
      user.sub,
      user.role,
    );
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    return result;
  }

  // Siklus 5 (revisi) — tambah temuan masalah baru ke job yang sedang
  // berjalan. Menggantikan konsep "checklist tetap"; ini yang dinamis.
  @Roles('admin', 'teknisi')
  @Post(':id/findings')
  addFinding(
    @Param('id') id: string,
    @Body() dto: AddFindingDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.jobs.addFinding(id, dto, user.sub, user.role);
  }

  // Ganti POST /technician-jobs/:id/photos (model lama, level-job) — foto
  // sekarang melekat ke satu temuan (JobFinding), bisa dipanggil berkali-kali
  // per kind (tidak dibatasi cuma 1 foto).
  @Roles('admin', 'teknisi')
  @Post(':id/findings/:findingId/photos')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: './uploads/job-photos',
        // Nama file di-generate SERVER (UUID + ekstensi dari mimetype
        // ter-whitelist) — file.originalname TIDAK PERNAH dipakai buat path,
        // biar gak bisa path-traversal ataupun nyelundup ekstensi berbahaya
        // (mis. .html/.svg yang bisa stored-XSS lewat static /uploads).
        filename: (_, file, cb) => {
          const ext = ALLOWED_PHOTO_MIME[file.mimetype];
          if (!ext)
            return cb(
              new BadRequestException('Tipe file harus JPG/PNG/WEBP'),
              '',
            );
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (_, file, cb) => {
        if (!ALLOWED_PHOTO_MIME[file.mimetype]) {
          return cb(
            new BadRequestException('Tipe file harus JPG/PNG/WEBP'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — cukup buat foto HP, cegah upload segede-gedenya
    }),
  )
  // Siklus 9 — nerima field opsional `clientActionId` di form-data (Flutter
  // isi ini kalau upload ini adalah "tahap 1" dari alur foto offline: foto
  // diambil offline, disimpan lokal, baru di-upload ke sini begitu online
  // lagi). Kalau `clientActionId` gak dikirim (alur online normal Siklus 5),
  // perilakunya PERSIS SAMA seperti sebelumnya — gak ada perubahan apa pun.
  async addFindingPhoto(
    @Param('id') id: string,
    @Param('findingId') findingId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind: 'sebelum' | 'sesudah',
    @Body('clientActionId') clientActionId: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!clientActionId) {
      return this.jobs.addFindingPhoto(
        id,
        findingId,
        kind,
        `/uploads/job-photos/${file.filename}`,
        user.sub,
        user.role,
      );
    }

    // Klaim DULU (INSERT-first, sama pola kayak OfflineSyncService.claim)
    // sebelum sentuh DB job-finding-nya — sebelumnya di sini cek-baru-tulis
    // (findLoggedAction lalu persistFindingPhotoLog belakangan), jadi 2
    // upload dengan clientActionId sama yang nabrak bareng bisa dua-duanya
    // lolos cek "belum ada log", dua-duanya bikin row job_finding_photos +
    // file fisik, dan yang kalah pas nulis log malah nge-throw P2002 gak
    // ketangkep (500 mentah, padahal upload-nya sendiri sebenernya berhasil).
    const claim = await this.offlineSync.claimPhotoUpload(clientActionId, id);
    if (!claim.claimed) {
      if (!claim.cached || claim.cached.status === 'pending') {
        return {
          message:
            'Upload ini lagi diproses permintaan lain, coba lagi sebentar',
        };
      }
      return claim.cached.detail; // idempoten — retry upload gak bikin row job_finding_photos kedua
    }

    try {
      const photo = await this.jobs.addFindingPhoto(
        id,
        findingId,
        kind,
        `/uploads/job-photos/${file.filename}`,
        user.sub,
        user.role,
      );
      await this.offlineSync.completePhotoUpload(clientActionId, photo);
      return photo;
    } catch (err) {
      await this.offlineSync.releasePhotoUpload(clientActionId);
      throw err;
    }
  }

  @Roles('admin', 'teknisi')
  @Patch(':id/notes')
  updateNotes(
    @Param('id') id: string,
    @Body() dto: UpdateNotesDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.jobs.updateNotes(id, dto.notes, user.sub, user.role);
  }

  // Ganti PATCH :id/complete (dulu teknisi langsung nutup job sendiri).
  // Sekarang teknisi cuma mengajukan — job masuk 'menunggu_review', Admin
  // yang menyetujui lewat approve-complete di bawah.
  @Roles('admin', 'teknisi')
  @Patch(':id/submit-for-review')
  async submitForReview(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.jobs.submitForReview(id, user.sub, user.role);
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    return result;
  }

  @Roles('admin')
  @Patch(':id/approve-complete')
  async approveComplete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.jobs.approveComplete(id, user.role);
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    return result;
  }

  @Roles('admin')
  @Patch(':id/send-back')
  async sendBack(
    @Param('id') id: string,
    @Body() dto: SendBackDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.jobs.sendBack(id, dto.note, user.role);
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    return result;
  }

  @Roles('admin')
  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const result = await this.jobs.cancel(id, user.sub, user.role);
    this.realtime.emitToAdmin('job.status_changed', {
      jobId: id,
      status: result.status,
    });
    return result;
  }
}
