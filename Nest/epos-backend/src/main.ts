import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

function assertRequiredEnv() {
  // Sebelumnya JWT_SECRET punya fallback hardcoded ('dev-secret-ganti-di-env')
  // di auth.module.ts & jwt.strategy.ts — app tetep nyala normal kalau
  // .env lupa diisi, dan siapa pun yang tau string default itu (ada di
  // source, bukan rahasia) bisa forge JWT buat impersonasi user manapun
  // (termasuk admin) tanpa password. Sekarang app REFUSE start kalau
  // JWT_SECRET kosong, biar ketauan pas deploy bukan pas udah kejadian.
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET wajib diisi di .env — server sengaja gak mau start tanpa itu (lihat main.ts assertRequiredEnv).',
    );
  }
}

async function bootstrap() {
  assertRequiredEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({ origin: '*' });

  // Foto bukti servis (Fase 5, disk lokal — cukup untuk skala 1 toko).
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();