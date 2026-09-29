import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { LoginThrottleGuard } from './guards/login-throttle.guard';
import { PasswordThrottleGuard } from './guards/password-throttle.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      // Non-null assertion aman: main.ts (assertRequiredEnv) udah nolak app
      // start kalau JWT_SECRET kosong, jadi begitu kode ini jalan pasti
      // udah keisi. TIDAK ADA fallback hardcoded lagi (lihat catatan di
      // main.ts kenapa itu bahaya).
      secret: process.env.JWT_SECRET!,
      // Cast: @nestjs/jwt mengharap literal type `ms` (mis. "8h"), sementara
      // process.env selalu `string` biasa di TypeScript — aman di-cast karena
      // nilainya memang kita kontrol sendiri lewat .env.
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RolesGuard,
    LoginThrottleGuard,
    PasswordThrottleGuard,
  ],
  exports: [JwtModule],
})
export class AuthModule {}
