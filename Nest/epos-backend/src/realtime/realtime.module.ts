import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  // JwtModule di sini SENGAJA import langsung (bukan lewat AuthModule) biar
  // gak ada ketergantungan silang antar module — RealtimeGateway cuma butuh
  // JwtService buat verifikasi token socket, gak butuh apa pun dari
  // AuthModule lainnya (strategy/guard/dsb).
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
