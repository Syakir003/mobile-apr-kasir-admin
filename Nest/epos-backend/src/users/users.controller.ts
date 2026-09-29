import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ToggleActiveDto } from './dto/toggle-active.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserPayload) {
    return this.users.create(dto, user.sub);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  // Sebelumnya @Body('active') active: boolean tanpa DTO — ValidationPipe
  // Nest SKIP validasi buat parameter primitif (Boolean/String/Number),
  // jadi kirim body {"active":"false"} (string, gampang kejadian kalau
  // field form ke-serialize jadi text) lolos mentah-mentah ke Prisma dan
  // nge-crash 500 gak ketangkep (PrismaClientValidationError bukan
  // HttpException). Field kosong juga bikin update jadi no-op senyap yang
  // tetep dibalikin seolah sukses. DTO ini nutup dua-duanya.
  @Patch(':id/toggle-active')
  toggleActive(
    @Param('id') id: string,
    @Body() dto: ToggleActiveDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.users.toggleActive(id, dto.active, user.sub);
  }

  // Reset password staff lain (buat yang lupa password). Admin-only lewat
  // @Roles di level class. Buat ganti password SENDIRI, pakai
  // PATCH /auth/me/password — yang itu minta password lama, yang ini enggak.
  @Patch(':id/password')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.users.resetPassword(id, dto.newPassword, user.sub);
  }

  // Ganti role dan/atau nama tampilan setelah akun dibuat. Sengaja terpisah
  // dari toggle-active (lihat komentar UsersService.update).
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.users.update(id, dto, user.sub);
  }
}
