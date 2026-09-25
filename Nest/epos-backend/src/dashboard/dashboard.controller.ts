import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

// Endpoint ini murni snapshot buat first-load — TIDAK emit/listen
// WebSocket. Next.js/frontend panggil GET /dashboard/summary sekali pas
// halaman dashboard dibuka, lalu RealtimeGateway (Siklus 1) yang jaga data
// tetap update tanpa refresh lewat event transaction.created/
// job.status_changed/invoice.updated.
//
// 'kasir' ditambah sesi migrasi Flutter -> Nest: dashboard mobile
// (analyticsProvider) tampil buat admin & kasir (bukan admin-only kayak web),
// sama seperti dulu kasir bisa baca tabel invoices/transactions/technician_jobs
// langsung lewat RLS "baca admin/kasir" yang berlaku di hampir semua tabel
// finansial — endpoint ini cuma menyusul akses yang sudah ada, bukan
// membuka akses baru.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'kasir')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboard.summary();
  }
}
