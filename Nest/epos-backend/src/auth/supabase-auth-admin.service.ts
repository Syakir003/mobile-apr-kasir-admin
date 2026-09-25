import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Masa transisi: password & akun tetap dimiliki Supabase Auth (auth.users),
 * karena aplikasi Flutter yang terpasang masih login lewat Supabase. Operasi
 * yang MENULIS ke auth.users dikerjakan lewat Admin API GoTrue dengan
 * service_role — cara yang sama dengan Edge Function `admin-users` —
 * bukan menulis tabel auth.* langsung (skema internal GoTrue).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server saja, jangan ke client).
 */
@Injectable()
export class SupabaseAuthAdminService {
  private config() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new ServiceUnavailableException(
        'Pengelolaan akun belum dikonfigurasi (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)',
      );
    }
    return { url: url.replace(/\/$/, ''), key };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { url, key } = this.config();
    const res = await fetch(`${url}/auth/v1/admin${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg: string = data?.msg ?? data?.message ?? data?.error_description ?? `Supabase Auth ${res.status}`;
      if (/already|registered|exists/i.test(msg)) throw new ConflictException('Email sudah terdaftar');
      throw new BadRequestException(msg);
    }
    return data as T;
  }

  /** Akun baru, langsung terkonfirmasi (tanpa SMTP) — sama dengan admin-users. */
  async createUser(email: string, password: string, displayName: string): Promise<string> {
    const user = await this.request<{ id: string }>('POST', '/users', {
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    return user.id;
  }

  async updatePassword(userId: string, password: string): Promise<void> {
    await this.request('PUT', `/users/${encodeURIComponent(userId)}`, { password });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request('DELETE', `/users/${encodeURIComponent(userId)}`);
  }
}
