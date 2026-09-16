import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginThrottleGuard } from './guards/login-throttle.guard';
import { PasswordThrottleGuard } from './guards/password-throttle.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Fix dari audit: sebelumnya gak ada rate-limit sama sekali — mitigasi
  // timing (DUMMY_HASH di auth.service.ts) nutup email enumeration, tapi
  // endpoint ini masih bisa kena brute-force password online buat email
  // yang sudah ketebak. Lihat LoginThrottleGuard buat alasan kenapa
  // hand-roll (bukan @nestjs/throttler).
  @UseGuards(LoginThrottleGuard)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Profil sendiri. Data login emang udah dibalikin POST /auth/login, tapi
  // frontend yang di-refresh cuma pegang cookie/token — gak ada tempat
  // narik ulang nama & role tanpa maksa login lagi.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.me(user.sub);
  }

  // SEMUA role, bukan admin doang — ini ganti password SENDIRI. Sebelumnya
  // gak ada endpoint ini sama sekali: layar Profil di app Flutter lama
  // manggil `auth.updateUser()` punya Supabase, dan itu ikut hilang pas
  // pindah ke backend sendiri. Akibatnya gak ada satu pun cara buat siapa
  // pun ganti password — bukan cuma fitur kurang, tapi lubang operasional.
  //
  // Urutan guard PENTING: JwtAuthGuard dulu (ngisi request.user), baru
  // PasswordThrottleGuard yang ngunci rem-nya ke user itu.
  @UseGuards(JwtAuthGuard, PasswordThrottleGuard)
  @HttpCode(200)
  @Patch('me/password')
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
