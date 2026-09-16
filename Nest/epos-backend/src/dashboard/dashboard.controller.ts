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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboard.summary();
  }
}
