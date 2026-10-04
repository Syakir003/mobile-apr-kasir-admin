import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

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
  app.useGlobalFilters(new AllExceptionsFilter());
  // Header keamanan HTTP (nosniff, frame-ancestors, HSTS, dst). CORP cross-origin
  // supaya foto /uploads tetap bisa dimuat dari origin web.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Hanya percaya X-Forwarded-For dari nginx lokal — kalau port ini kebetulan
  // terbuka ke internet, header palsu diabaikan (rate limit login tak bisa dilewati).
  app.set('trust proxy', 'loopback');

  // Web memanggil backend dari server Next (tanpa CORS) dan mobile native tidak
  // butuh CORS, jadi default-nya TERTUTUP; isi FRONTEND_ORIGIN (dipisah koma)
  // hanya bila ada browser yang memanggil API ini langsung.
  const origins = process.env.FRONTEND_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : false });

  // Foto bukti servis dilayani UploadsController (wajib login / URL bertanda tangan).

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();