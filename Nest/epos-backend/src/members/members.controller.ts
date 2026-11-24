import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { MembersService } from './members.service';
import { SetWaOptOutDto } from './dto/set-wa-opt-out.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { MemberListQueryDto } from './dto/member-list-query.dto';
import { SetPriceTierDto } from './dto/set-price-tier.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { CreateMemberLocationDto, MoveUnitsLocationDto, UpdateMemberLocationDto } from './dto/member-location.dto';

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

  /** Halaman "Member" — tabel semua member, per halaman: { items, total, page, pageSize, totalPages }. */
  @Roles('admin', 'kasir')
  @Get()
  findAll(@Query() query: MemberListQueryDto) {
    return this.members.findAll(query);
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

  /** Edit data member (form Member di mobile). */
  @Roles('admin', 'kasir')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto, @CurrentUser() user: CurrentUserPayload) {
    return this.members.update(id, dto, user.sub);
  }

  // ---- Multi lokasi (2026-11). Lokasi 1 = alamat utama member (diubah lewat PATCH :id); di sini lokasi TAMBAHAN.

  /** Tambah lokasi tambahan (hanya untuk member yang multi lokasinya menyala). */
  @Roles('admin', 'kasir')
  @Post(':id/locations')
  addLocation(@Param('id') id: string, @Body() dto: CreateMemberLocationDto, @CurrentUser() user: CurrentUserPayload) {
    return this.members.addLocation(id, dto, user.sub);
  }

  @Roles('admin', 'kasir')
  @Patch(':id/locations/:locationId')
  updateLocation(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateMemberLocationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.members.updateLocation(id, locationId, dto, user.sub);
  }

  /** Hapus lokasi tambahan; ditolak selama masih dipakai unit atau order. */
  @Roles('admin', 'kasir')
  @Delete(':id/locations/:locationId')
  removeLocation(
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.members.removeLocation(id, locationId, user.sub);
  }

  /** Pindahkan beberapa unit AC member ke satu lokasi sekaligus ('utama' = Lokasi 1). */
  @Roles('admin', 'kasir')
  @Post(':id/units/move-location')
  moveUnitsToLocation(
    @Param('id') id: string,
    @Body() dto: MoveUnitsLocationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.members.moveUnitsToLocation(id, dto, user.sub);
  }

  /** Ubah tipe pembeli (Ritel/Installer/Reseller) — admin saja, karena
   * tipe menentukan harga jual. Kasir cuma bisa memilihnya saat membuat member. */
  @Roles('admin')
  @Patch(':id/price-tier')
  setPriceTier(
    @Param('id') id: string,
    @Body() dto: SetPriceTierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.members.setPriceTier(id, dto.priceTier, user.sub);
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
