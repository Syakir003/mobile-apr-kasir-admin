import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';

// Whitelist ekstensi foto — dicocokkan dari mimetype yang dideteksi multer
// (bukan dari nama file client, yang gampang dipalsu). Nama file FINAL selalu
// di-generate server (randomUUID), TIDAK PERNAH pakai file.originalname mentah
// — cegah path traversal (mis. "../../../../src/main.js") dan ekstensi
// berbahaya (.html/.svg yang bisa stored-XSS lewat /uploads).
const ALLOWED_PHOTO_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const REJECT = () => new BadRequestException('Tipe file harus JPG/PNG/WEBP');

/** Opsi FileInterceptor untuk foto: simpan ke `./uploads/<dir>` (dibuat otomatis oleh multer). */
export function photoUploadOptions(dir: string, maxMb: number): MulterOptions {
  return {
    storage: diskStorage({
      destination: `./uploads/${dir}`,
      filename: (_, file, cb) => {
        const ext = ALLOWED_PHOTO_MIME[file.mimetype];
        if (!ext) return cb(REJECT(), '');
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    fileFilter: (_, file, cb) => {
      if (!ALLOWED_PHOTO_MIME[file.mimetype]) return cb(REJECT(), false);
      cb(null, true);
    },
    limits: { fileSize: maxMb * 1024 * 1024 },
  };
}
