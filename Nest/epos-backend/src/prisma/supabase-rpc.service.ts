import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Identitas pemanggil — bentuk yang sama dengan `CurrentUserPayload`. */
export interface RpcActor {
  sub: string;
  role: 'admin' | 'kasir' | 'teknisi';
}

const FN_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Menjalankan RPC PL/pgSQL Supabase (backend/supabase/migrations) atas nama
 * user yang login — konteksnya dibuat SAMA dengan panggilan lewat PostgREST:
 *   - `set local role authenticated`  -> grant EXECUTE & RLS (fungsi invoker)
 *     berlaku persis seperti dari aplikasi Flutter;
 *   - `request.jwt.claims` {sub, role, user_role} -> auth.uid() & jwt_role().
 * Keduanya `local` (hanya transaksi ini), jadi koneksi pool tidak tercemar.
 *
 * Masa transisi: operasi tulis yang di Supabase sudah punya RPC dijalankan
 * lewat sini, supaya perilaku API NestJS identik dengan aplikasi lama (satu
 * implementasi, tanpa logika ganda, trigger notifikasi tidak dobel). Pemindahan
 * ke TypeScript dilakukan per fungsi belakangan dengan RPC sebagai acuan uji.
 */
@Injectable()
export class SupabaseRpcService {
  constructor(private readonly prisma: PrismaService) {}

  /** RPC berpola `fn(payload jsonb)` — mayoritas RPC. */
  call<T = unknown>(actor: RpcActor, fn: string, payload: object = {}): Promise<T> {
    return this.run<T>(actor, fn, '$1::jsonb', [JSON.stringify(payload)]);
  }

  /** RPC tanpa argumen, mis. `list_wa_reminder_templates()`. */
  callNoArgs<T = unknown>(actor: RpcActor, fn: string): Promise<T> {
    return this.run<T>(actor, fn, '', []);
  }

  /**
   * RPC dengan argumen bernama, mis. `generate_ac_unit_barcode(p_unit_id)`.
   * Nilai objek/array dikirim sebagai JSON; tipe diresolusi Postgres dari
   * signature fungsi.
   */
  callNamed<T = unknown>(actor: RpcActor, fn: string, args: Record<string, unknown>): Promise<T> {
    const names = Object.keys(args);
    for (const n of names) if (!FN_NAME.test(n)) throw new Error(`Nama argumen RPC tidak valid: ${n}`);
    const values = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    return this.run<T>(actor, fn, names.map((n, i) => `${n} => $${i + 1}`).join(', '), values);
  }

  private async run<T>(actor: RpcActor, fn: string, argSql: string, values: unknown[]): Promise<T> {
    if (!FN_NAME.test(fn)) throw new Error(`Nama RPC tidak valid: ${fn}`);
    const claims = JSON.stringify({ sub: actor.sub, role: 'authenticated', user_role: actor.role });
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`, claims);
        await tx.$executeRawUnsafe('set local role authenticated');
        const rows = await tx.$queryRawUnsafe<{ result: T }[]>(
          `select public.${fn}(${argSql}) as result`,
          ...values,
        );
        return rows[0]?.result as T;
      });
    } catch (e) {
      throw toHttpException(e);
    }
  }
}

/**
 * `raise exception '<pesan>'` di RPC -> HttpException dengan pesan yang sama
 * (pesan inilah yang selama ini tampil di aplikasi). Status ditebak dari pola
 * pesan yang dipakai konsisten di migrasi: "Hanya ..." = 403, "... tidak
 * ditemukan" = 404, unique violation = 409, sisanya 400. Error non-RAISE
 * (bug/koneksi) dilempar ulang apa adanya -> 500.
 */
export function toHttpException(e: unknown): unknown {
  if (e instanceof HttpException) return e;
  const { message, code } = pgError(e);
  if (!message) return e;
  if (code === '23505') return new ConflictException(message);
  if (code && code !== 'P0001' && code !== '22P02' && code !== '23514') return e;
  if (/^Hanya\b/i.test(message) || /bukan (milik|hak)/i.test(message)) return new ForbiddenException(message);
  if (/tidak ditemukan/i.test(message)) return new NotFoundException(message);
  return new BadRequestException(message);
}

function pgError(e: unknown): { message?: string; code?: string } {
  // Prisma + driver adapter pg: error Postgres asli ada di
  // meta.driverAdapterError.cause {originalCode, originalMessage}.
  const cause = (e as any)?.meta?.driverAdapterError?.cause;
  if (cause?.kind !== 'postgres') return {};
  return { code: cause.originalCode, message: cause.originalMessage };
}
