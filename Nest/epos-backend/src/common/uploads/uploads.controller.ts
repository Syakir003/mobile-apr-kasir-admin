import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync } from 'fs';
import { resolve, sep } from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

// Foto bukti servis memuat lokasi/rumah pelanggan — dulu disajikan statis
// publik (useStaticAssets), sekarang wajib terautentikasi:
//  - Web: proxy Next menyisipkan Bearer -> lolos JwtAuthGuard penuh
//    (cek akun aktif + password-changed-at, sama seperti REST lain).
//  - Mobile: Image.network tidak bisa kirim header -> minta URL bertanda
//    tangan HMAC via GET /uploads/sign (berumur TTL_SEC, terikat ke satu file).
const ROOT = resolve('uploads'); // sama dengan destination multer ('./uploads/...', relatif cwd)
const TTL_SEC = 60 * 60;

const sign = (rel: string, exp: number) =>
  createHmac('sha256', `uploads:${process.env.JWT_SECRET}`)
    .update(`${rel}.${exp}`)
    .digest('hex');

function safeAbs(rel: string): string {
  const abs = resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + sep)) throw new BadRequestException('Path tidak valid');
  return abs;
}

@Injectable()
export class UploadsAccessGuard extends JwtAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const { exp, sig } = req.query ?? {};
    if (typeof exp === 'string' && typeof sig === 'string') {
      const rel = (req.params.path as string[]).join('/');
      const expected = Buffer.from(sign(rel, Number(exp)), 'hex');
      const given = Buffer.from(sig, 'hex');
      if (
        Number(exp) > Date.now() / 1000 &&
        given.length === expected.length &&
        timingSafeEqual(given, expected)
      ) {
        return true;
      }
    }
    return (await super.canActivate(ctx)) as boolean;
  }
}

@Controller('uploads')
export class UploadsController {
  /** Terautentikasi -> URL bertanda tangan untuk satu file (mobile). */
  @UseGuards(JwtAuthGuard)
  @Get('sign')
  signUrl(@Query('path') path: string) {
    const rel = String(path ?? '').replace(/^\/?uploads\//, '');
    if (!existsSync(safeAbs(rel))) throw new NotFoundException('File tidak ditemukan');
    const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
    return { url: `/uploads/${rel}?exp=${exp}&sig=${sign(rel, exp)}`, expiresAt: exp };
  }

  @UseGuards(UploadsAccessGuard)
  @Get('*path')
  file(@Param('path') parts: string[], @Res() res: Response) {
    const abs = safeAbs(parts.join('/'));
    if (!existsSync(abs)) throw new NotFoundException('File tidak ditemukan');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(abs, { dotfiles: 'deny' });
  }
}
