import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Key standar yang dipakai aplikasi — kalau row-nya belum pernah diisi
 * admin di DB, `getAll()` fallback ke nilai default di sini (bukan error/
 * undefined), biar frontend gak perlu handling kosong-vs-belum-ada. */
const DEFAULT_CONFIG: Record<string, string> = {
  default_tax_percent: '0',
  invoice_footer_note: '',
  printer_name: '',
  invoice_number_format: 'INV-{YYYYMMDD}-{SEQ}',
};

@Injectable()
export class AppConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Balikin semua config sebagai map key->value, di-fallback ke default
   * kalau row belum pernah diisi admin. */
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.appConfig.findMany();
    const map: Record<string, string> = { ...DEFAULT_CONFIG };
    for (const row of rows) {
      if (row.value !== null) map[row.key] = row.value;
    }
    return map;
  }

  /**
   * Fix dari audit: sebelumnya `key` dari URL param diterima MENTAH tanpa
   * validasi terhadap daftar key yang dikenal — admin salah ketik (mis.
   * `defaul_tax_percent`) bikin row baru yang gak pernah kebaca `getAll()`
   * (cuma key yang match DEFAULT_CONFIG yang di-override), silent data
   * pollution tanpa error/warning sama sekali.
   */
  async upsert(key: string, value: string) {
    if (!(key in DEFAULT_CONFIG)) {
      throw new BadRequestException(
        `Key config tidak dikenal: "${key}". Key yang valid: ${Object.keys(DEFAULT_CONFIG).join(', ')}`,
      );
    }
    return this.prisma.appConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
