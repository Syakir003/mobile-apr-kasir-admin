import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { createPublicKey } from 'crypto';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

/** Issuer token yang diterbitkan NestJS sendiri (POST /auth/login). */
export const NEST_JWT_ISSUER = 'epos-nest';

export interface JwtPayload {
  sub: string;
  iss?: string;
  aud?: string | string[];
  /** Token Nest: role aplikasi. Token Supabase: selalu "authenticated". */
  role?: string;
  iat?: number;
}

const logger = new Logger('JwtStrategy');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Masa transisi — dua jenis access token diterima:
 *  1. Token Supabase Auth (aplikasi Flutter login ke Supabase, lalu memanggil
 *     API NestJS dengan token yang sama — tidak perlu login dua kali).
 *     Diverifikasi dengan JWKS proyek (ES256/RS256) atau, untuk proyek/stack
 *     lokal yang masih HS256, SUPABASE_JWT_SECRET. Wajib aud & role
 *     "authenticated" + sub → key anon/service_role otomatis ditolak.
 *  2. Token NestJS (iss = "epos-nest", HS256 JWT_SECRET) — web Next.js.
 * Kunci dipilih dari `iss` + `alg` di header, lalu pasangan itu dikunci
 * (HS256 hanya dengan secret simetris, ES/RS hanya dengan kunci publik JWKS)
 * sehingga serangan algorithm-confusion tidak mungkin.
 *
 * Role TIDAK diambil dari token: selalu dibaca ulang dari public.users per
 * request, dan akun nonaktif langsung ditolak (setara assert_caller_role).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256', 'ES256', 'RS256'],
      secretOrKeyProvider: (_req: unknown, rawJwt: string, done: (err: unknown, key?: string) => void) => {
        resolveKey(rawJwt).then((key) => done(null, key), (err) => done(err));
      },
    });
  }

  async validate(payload: JwtPayload) {
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw new UnauthorizedException('Token tidak valid');
    }
    if (payload.iss === supabaseIssuer()) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes('authenticated') || payload.role !== 'authenticated') {
        throw new UnauthorizedException('Token tidak valid');
      }
    } else if (payload.iss !== NEST_JWT_ISSUER) {
      throw new UnauthorizedException('Token tidak valid');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Akun tidak aktif atau tidak ditemukan');
    }
    return { sub: user.id, role: user.role, displayName: user.displayName };
  }
}

function supabaseIssuer(): string | undefined {
  if (process.env.SUPABASE_JWT_ISSUER) return process.env.SUPABASE_JWT_ISSUER;
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  return url ? `${url}/auth/v1` : undefined;
}

function decodePart(part: string | undefined): any {
  try {
    return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// exported buat testability (jwt.strategy.spec.ts) — logic-nya sendiri tetap
// cuma dipakai internal lewat secretOrKeyProvider di atas.
export async function resolveKey(rawJwt: string): Promise<string> {
  const [h, p] = rawJwt.split('.');
  const header = decodePart(h);
  const payload = decodePart(p);
  if (!header || !payload) throw new UnauthorizedException('Token tidak valid');

  const issuer = supabaseIssuer();
  if (issuer && payload.iss === issuer) {
    if (header.alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret) throw new UnauthorizedException('Token Supabase HS256 tidak didukung');
      return secret;
    }
    if (header.alg === 'ES256' || header.alg === 'RS256') {
      return jwksKey(String(header.kid ?? ''), header.alg);
    }
    throw new UnauthorizedException('Algoritma token tidak didukung');
  }
  if (payload.iss === NEST_JWT_ISSUER && header.alg === 'HS256') {
    return process.env.JWT_SECRET!;
  }
  throw new UnauthorizedException('Token tidak valid');
}

// ---------------------------------------------------------------- JWKS cache
/** kid -> kunci publik PEM. */
let jwks: Map<string, { key: string; alg?: string }> = new Map();
let fetchedAt = 0;
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFETCH_MS = 60_000; // kid asing tidak boleh memicu fetch beruntun

async function jwksKey(kid: string, alg: string): Promise<string> {
  const now = Date.now();
  const stale = now - fetchedAt > JWKS_TTL_MS;
  if ((stale || !jwks.has(kid)) && now - fetchedAt > JWKS_MIN_REFETCH_MS) {
    await refreshJwks();
  }
  const entry = jwks.get(kid);
  if (!entry || (entry.alg && entry.alg !== alg)) {
    throw new UnauthorizedException('Kunci token tidak dikenal');
  }
  return entry.key;
}

async function refreshJwks() {
  const issuer = supabaseIssuer();
  if (!issuer) return;
  fetchedAt = Date.now();
  try {
    const res = await fetch(`${issuer}/.well-known/jwks.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: any[] };
    const next = new Map<string, { key: string; alg?: string }>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || (jwk.kty !== 'EC' && jwk.kty !== 'RSA')) continue;
      const pem = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
      next.set(jwk.kid, { key: pem.toString(), alg: jwk.alg });
    }
    jwks = next;
  } catch (e) {
    // Kunci lama tetap dipakai sampai fetch berikutnya berhasil.
    logger.warn(`Gagal mengambil JWKS Supabase: ${e}`);
  }
}
