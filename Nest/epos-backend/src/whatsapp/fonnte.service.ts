import { Injectable, Logger } from '@nestjs/common';

export interface FonnteSendResult {
  ok: boolean;
  raw: unknown;
  error?: string;
}

/**
 * Klien tipis ke Fonnte (https://api.fonnte.com/send) — provider WhatsApp
 * gateway yang dipilih user. SENGAJA didesain "gagal aman" persis pola
 * FirebaseAdminService (notifications module): kalau FONNTE_API_KEY belum
 * diisi di .env, service ini nonaktif diam-diam (isConfigured()=false)
 * bukan nge-crash start aplikasi — WhatsappLog tetap kebuat berstatus
 * 'gagal' dengan error yang jelas, bukan error 500 mentah.
 *
 * Field request & bentuk response di sini hasil riset langsung ke dokumentasi
 * Fonnte (bukan tebakan): POST form-urlencoded, header `Authorization:
 * <token>` (TANPA prefix 'Bearer'), response `{ status: true/false, detail,
 * id: [...], target: [...] }`.
 */
@Injectable()
export class FonnteService {
  private readonly logger = new Logger(FonnteService.name);
  private warnedOnce = false;

  isConfigured(): boolean {
    return !!process.env.FONNTE_API_KEY;
  }

  /**
   * `target` HARUS sudah dinormalisasi lewat waPhone() sebelum dipanggil
   * (62xxxxxxxxxx, tanpa '+') — service ini murni transport, gak nge-validasi
   * format nomor.
   */
  async send(target: string, message: string): Promise<FonnteSendResult> {
    const apiKey = process.env.FONNTE_API_KEY;
    if (!apiKey) {
      if (!this.warnedOnce) {
        this.logger.warn(
          'FONNTE_API_KEY belum diisi — pengiriman WhatsApp di-skip, WhatsappLog akan dicatat gagal.',
        );
        this.warnedOnce = true;
      }
      return { ok: false, raw: null, error: 'FONNTE_API_KEY belum dikonfigurasi' };
    }

    const body = new URLSearchParams({
      target,
      message,
      countryCode: '62',
    });

    try {
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const raw: unknown = await res.json().catch(() => null);
      const parsed = raw as { status?: boolean; detail?: string; reason?: string } | null;

      if (!res.ok || !parsed?.status) {
        const reason = parsed?.reason || parsed?.detail || `HTTP ${res.status}`;
        return { ok: false, raw, error: reason };
      }
      return { ok: true, raw };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Gagal menghubungi Fonnte: ${message}`);
      return { ok: false, raw: null, error: message };
    }
  }
}
