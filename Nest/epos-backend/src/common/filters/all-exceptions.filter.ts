import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { mapPrismaError } from './prisma-error.util';
import { translateValidationMessage } from './validation-message.util';

/**
 * Filter global: SEMUA error balik sebagai JSON `{statusCode, message, error}`
 * dengan pesan Indonesia yang sesuai konteks — gak ada lagi "Internal server
 * error" mentah / stack Prisma yang bocor ke klien.
 * - HttpException: perilaku lama (status & pesan apa adanya).
 * - Error Prisma (unik, FK, tidak ditemukan, dst): dipetakan di mapPrismaError.
 * - Sisanya: 500 dengan pesan umum; detailnya hanya di log server.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] =
      'Terjadi kesalahan di server. Coba lagi; kalau terus terjadi hubungi admin.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : ((body as any)?.message ?? exception.message);
      // Error validasi input (400) diterjemahkan & digabung jadi satu kalimat.
      message = status === HttpStatus.BAD_REQUEST ? translateValidationMessage(raw) : raw;
      if (status === HttpStatus.UNAUTHORIZED && message === 'Unauthorized') {
        message = 'Sesi login habis atau tidak valid. Silakan login lagi.';
      } else if (status === HttpStatus.FORBIDDEN && message === 'Forbidden resource') {
        message = 'Kamu tidak punya akses untuk aksi ini.';
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      ({ status, message } = mapPrismaError(exception));
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Data yang dikirim tidak valid.';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database tidak bisa dihubungi. Coba lagi sebentar.';
    }

    if (status >= 500) {
      // Detail lengkap cuma di log server, bukan di response.
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status] ?? 'Error',
    });
  }
}
