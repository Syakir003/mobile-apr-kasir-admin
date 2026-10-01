import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface MappedError {
  status: number;
  message: string;
}

/** Nama constraint unik -> label yang enak dibaca admin. Default Prisma:
 * `<tabel>_<kolom>_key`. */
const UNIQUE_LABELS: Record<string, string> = {
  spareparts_sku_key: 'SKU sparepart',
  products_sku_key: 'SKU produk',
  users_email_key: 'Email',
  vouchers_code_key: 'Kode voucher',
  invoices_number_key: 'Nomor invoice',
  member_ac_units_barcode_value_key: 'Barcode unit AC',
  problem_categories_name_key: 'Nama kategori masalah',
  stock_units_unit_code_key: 'Kode unit stok',
  stock_units_qr_token_key: 'QR unit stok',
  device_tokens_token_key: 'Token perangkat',
  sync_action_log_client_action_id_key: 'ID aksi sinkronisasi',
  whatsapp_logs_dedupe_key_key: 'Pesan WhatsApp',
};

/** Ambil nama constraint/kolom dari error Prisma (format beda-beda antara
 * engine biasa dan driver adapter Prisma 7). */
function constraintOf(err: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = (err.meta ?? {}) as Record<string, any>;
  const fromAdapter = meta.driverAdapterError?.cause?.constraint;
  const candidates = [
    meta.constraint?.index,
    meta.constraint?.fields,
    fromAdapter?.index,
    fromAdapter?.fields,
    meta.target,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (Array.isArray(c) && c.length) return c.join(', ');
  }
  return undefined;
}

/** Pemetaan error Prisma (DB) -> status HTTP + pesan sesuai konteks. */
export function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): MappedError {
  switch (err.code) {
    case 'P2002': {
      const c = constraintOf(err);
      const label = c ? UNIQUE_LABELS[c] : undefined;
      if (label) return { status: HttpStatus.CONFLICT, message: `${label} sudah dipakai data lain. Gunakan nilai yang berbeda.` };
      return {
        status: HttpStatus.CONFLICT,
        message: 'Data dengan nilai yang sama sudah ada. Gunakan nilai yang berbeda.',
      };
    }
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Data tidak ditemukan atau sudah dihapus.' };
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        message: 'Data ini terhubung dengan data lain (masih dipakai atau rujukannya tidak ada), jadi aksi tidak bisa dilakukan.',
      };
    case 'P2000':
      return { status: HttpStatus.BAD_REQUEST, message: 'Salah satu isian terlalu panjang.' };
    case 'P2020':
    case 'P2033':
      return { status: HttpStatus.BAD_REQUEST, message: 'Angka yang diisi terlalu besar atau di luar batas.' };
    case 'P2034':
      return { status: HttpStatus.CONFLICT, message: 'Data sedang diubah oleh proses lain. Coba lagi sebentar.' };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Terjadi kesalahan pada database. Coba lagi; kalau terus terjadi hubungi admin.',
      };
  }
}
