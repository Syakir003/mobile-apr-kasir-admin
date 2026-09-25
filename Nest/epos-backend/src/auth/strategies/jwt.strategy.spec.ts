import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';

const SUPABASE_URL = 'https://xmzrzcgllztwikzdxfrt.supabase.co';
const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;
const NEST_SECRET = 'nest-test-secret';
const VALID_UUID = '5c612ddb-5d99-4d9f-ba9f-70ef9134f027';

/**
 * `resolveKey`/`refreshJwks` di jwt.strategy.ts punya cache module-level
 * (`jwks`, `fetchedAt`) — jest.resetModules() + require() ulang tiap test
 * biar tiap test mulai dari cache kosong (independen), bukan numpuk state
 * dari test sebelumnya. `UnauthorizedException` DIAMBIL DARI require yang
 * sama (bukan import top-level file ini) — kalau tidak, instanceof di
 * `.toThrow(UnauthorizedException)` gagal terus: resetModules() mereset
 * SEMUA module cache termasuk `@nestjs/common`, jadi class yang dipakai
 * jwt.strategy.ts (hasil require setelah reset) jadi instance module yang
 * beda dari yang di-import statis di atas file ini (sebelum reset manapun).
 */
function loadStrategy() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./jwt.strategy');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { UnauthorizedException } = require('@nestjs/common');
  return { ...mod, UnauthorizedException };
}

function ecKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), jwk };
}

function mockJwks(jwks: Record<string, unknown>[]) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ keys: jwks }),
  });
}

describe('jwt.strategy resolveKey (verifikasi token Supabase ES256 via JWKS)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SUPABASE_URL, JWT_SECRET: NEST_SECRET };
    delete process.env.SUPABASE_JWT_ISSUER;
    delete process.env.SUPABASE_JWT_SECRET;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('token Supabase ES256 dgn kid yang ada di JWKS -> balikin PEM yang beneran cocok (verifikasi round-trip)', async () => {
    const { privateKeyPem, jwk } = ecKeyPair();
    const kid = 'kid-1';
    mockJwks([{ ...jwk, kid, alg: 'ES256', use: 'sig' }]);
    const { resolveKey } = loadStrategy();

    const token = jwt.sign(
      { sub: VALID_UUID, aud: 'authenticated', role: 'authenticated' },
      privateKeyPem,
      { algorithm: 'ES256', issuer: SUPABASE_ISSUER, keyid: kid },
    );

    const key = await resolveKey(token);
    expect(key).toContain('BEGIN PUBLIC KEY');
    // Kalau PEM yang dibalikin BUKAN pasangan asli private key di atas,
    // verify di bawah gagal — bukti resolveKey() balikin kunci yang BENAR,
    // bukan cuma "sesuatu yang mirip PEM".
    expect(() => jwt.verify(token, key, { algorithms: ['ES256'] })).not.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('kid gak dikenal (di luar JWKS) -> tetap nge-refresh JWKS dulu, lalu ditolak', async () => {
    const { jwk } = ecKeyPair();
    mockJwks([{ ...jwk, kid: 'kid-yang-ada', alg: 'ES256', use: 'sig' }]);
    const { resolveKey, UnauthorizedException } = loadStrategy();

    const { privateKeyPem } = ecKeyPair();
    const esToken = jwt.sign({ sub: VALID_UUID }, privateKeyPem, {
      algorithm: 'ES256',
      issuer: SUPABASE_ISSUER,
      keyid: 'kid-asing-gak-ada',
    });

    await expect(resolveKey(esToken)).rejects.toThrow(UnauthorizedException);
    expect(global.fetch).toHaveBeenCalledTimes(1); // refresh BENERAN dicoba, bukan langsung nolak tanpa cek
  });

  it('issuer gak cocok SUPABASE_URL maupun NEST_JWT_ISSUER -> ditolak, gak fetch JWKS sama sekali', async () => {
    mockJwks([]);
    const { resolveKey, UnauthorizedException } = loadStrategy();
    const { privateKeyPem } = ecKeyPair();
    const token = jwt.sign({ sub: VALID_UUID }, privateKeyPem, {
      algorithm: 'ES256',
      issuer: 'https://issuer-lain.example.com/auth/v1',
      keyid: 'kid-1',
    });

    await expect(resolveKey(token)).rejects.toThrow(UnauthorizedException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('token rusak/bukan JWT sama sekali -> ditolak', async () => {
    const { resolveKey, UnauthorizedException } = loadStrategy();
    await expect(resolveKey('bukan.jwt.valid')).rejects.toThrow(UnauthorizedException);
  });

  it('token NestJS (iss epos-nest, HS256) -> balikin JWT_SECRET persis, verify sukses', async () => {
    const { resolveKey, NEST_JWT_ISSUER } = loadStrategy();
    const token = jwt.sign({ sub: VALID_UUID, role: 'admin' }, NEST_SECRET, {
      algorithm: 'HS256',
      issuer: NEST_JWT_ISSUER,
    });

    const key = await resolveKey(token);
    expect(key).toBe(NEST_SECRET);
    expect(() => jwt.verify(token, key, { algorithms: ['HS256'] })).not.toThrow();
  });

  it('algorithm-confusion: iss epos-nest tapi header alg ES256 -> ditolak (pasangan iss+alg dikunci)', async () => {
    const { resolveKey, UnauthorizedException } = loadStrategy();
    const { privateKeyPem } = ecKeyPair();
    const token = jwt.sign({ sub: VALID_UUID }, privateKeyPem, {
      algorithm: 'ES256',
      issuer: 'epos-nest',
      keyid: 'kid-1',
    });

    await expect(resolveKey(token)).rejects.toThrow(UnauthorizedException);
  });

  it('token Supabase HS256 tanpa SUPABASE_JWT_SECRET diset -> ditolak (bukan fallback diam-diam)', async () => {
    const { resolveKey, UnauthorizedException } = loadStrategy();
    const token = jwt.sign({ sub: VALID_UUID }, 'secret-asal', {
      algorithm: 'HS256',
      issuer: SUPABASE_ISSUER,
    });

    await expect(resolveKey(token)).rejects.toThrow(UnauthorizedException);
  });
});

describe('JwtStrategy.validate (role & status akun, terlepas dari klaim JWT)', () => {
  const OLD_ENV = process.env;
  let findUnique: jest.Mock;
  let strategy: any;
  let UnauthorizedException: any;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SUPABASE_URL };
    const loaded = loadStrategy();
    UnauthorizedException = loaded.UnauthorizedException;
    findUnique = jest.fn();
    strategy = new loaded.JwtStrategy({ user: { findUnique } });
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('token Supabase valid (aud+role authenticated) + user aktif di DB -> lolos, role dibaca dari DB bukan token', async () => {
    findUnique.mockResolvedValue({ id: VALID_UUID, role: 'kasir', displayName: 'Kasir Toko', active: true });
    const result = await strategy.validate({
      sub: VALID_UUID,
      iss: SUPABASE_ISSUER,
      aud: 'authenticated',
      role: 'authenticated',
    });
    expect(result).toEqual({ sub: VALID_UUID, role: 'kasir', displayName: 'Kasir Toko' });
  });

  it('token Supabase dgn role BUKAN "authenticated" (mis. anon/service_role) -> ditolak walau sub valid', async () => {
    await expect(
      strategy.validate({ sub: VALID_UUID, iss: SUPABASE_ISSUER, aud: 'authenticated', role: 'service_role' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('aud gak termasuk "authenticated" -> ditolak', async () => {
    await expect(
      strategy.validate({ sub: VALID_UUID, iss: SUPABASE_ISSUER, aud: 'anon', role: 'authenticated' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('sub bukan UUID -> ditolak sebelum sempat query DB', async () => {
    await expect(
      strategy.validate({ sub: 'bukan-uuid', iss: SUPABASE_ISSUER, aud: 'authenticated', role: 'authenticated' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('user valid di JWT tapi sudah dinonaktifkan/dihapus di public.users -> ditolak', async () => {
    findUnique.mockResolvedValue({ id: VALID_UUID, role: 'kasir', displayName: 'X', active: false });
    await expect(
      strategy.validate({ sub: VALID_UUID, iss: SUPABASE_ISSUER, aud: 'authenticated', role: 'authenticated' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('user gak ketemu sama sekali -> ditolak', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: VALID_UUID, iss: SUPABASE_ISSUER, aud: 'authenticated', role: 'authenticated' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token NestJS (iss epos-nest) + user aktif -> lolos', async () => {
    findUnique.mockResolvedValue({ id: VALID_UUID, role: 'admin', displayName: 'Admin', active: true });
    const result = await strategy.validate({ sub: VALID_UUID, iss: 'epos-nest', role: 'admin' });
    expect(result).toEqual({ sub: VALID_UUID, role: 'admin', displayName: 'Admin' });
  });

  it('iss bukan Supabase maupun epos-nest -> ditolak', async () => {
    await expect(strategy.validate({ sub: VALID_UUID, iss: 'https://issuer-random.example.com' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
