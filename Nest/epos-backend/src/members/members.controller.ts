import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { MembersService } from './members.service';
import { SetWaOptOutDto } from './dto/set-wa-opt-out.dto';
import { CreateMemberDto } from './dto/create-member.dto';

/** Baru ditambah Siklus 6 — sebelumnya MembersService murni internal
 * (findOrCreate dipanggil dari POS/ServiceOrders), gak ada endpoint REST
 * sama sekali buat cari member. Dibutuhin biar Admin bisa nyari memberId
 * buat nawarin voucher tanpa harus tau ID mentahnya. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  // 'search' didaftar SEBELUM ':id' di bawah biar /members/search gak
  // ketangkep sebagai findOne(id='search') — urutan method di controller
  // NestJS/Express nentuin prioritas match.
  @Roles('admin', 'kasir')
  @Get('search')
  search(@Query('q') q?: string) {
    return this.members.search(q ?? '');
  }

  /** Halaman "Member" — tabel semua member. */
  @Roles('admin', 'kasir')
  @Get()
  findAll(@Query('q') q?: string) {
    return this.members.findAll(q);
  }

  /** Detail member: unit AC + riwayat pembelian (invoice). */
  @Roles('admin', 'kasir')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.members.findOne(id);
  }

  /** Tambah member manual — daftarin pelanggan duluan sebelum ada transaksi
   * apapun (sebelumnya member CUMA kebentuk otomatis dari checkout). */
  @Roles('admin', 'kasir')
  @Post()
  create(@Body() dto: CreateMemberDto, @CurrentUser() user: CurrentUserPayload) {
    return this.members.create(dto, user.sub);
  }

  /** Pelanggan minta berhenti/lanjut dikirimi pengingat WA — Siklus WA/Fonnte. */
  @Roles('admin', 'kasir')
  @Patch(':id/wa-opt-out')
  setWaOptOut(
    @Param('id') id: string,
    @Body() dto: SetWaOptOutDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.members.setWaOptOut(id, dto.optOut, user.sub);
  }
}
