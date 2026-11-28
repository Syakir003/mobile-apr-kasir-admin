import { RealtimeGateway } from './realtime.gateway';

const iat = 1_700_000_000;

function setup(user: object | null) {
  const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', role: 'admin', iat }) };
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const gateway = new RealtimeGateway(jwt as never, prisma as never);
  let middleware!: (socket: never, next: (err?: Error) => void) => Promise<void>;
  gateway.afterInit({ use: (fn: typeof middleware) => (middleware = fn) } as never);
  const connect = async () => {
    const socket = { handshake: { auth: { token: 't' } }, data: {} as { user?: { role: string } } };
    const next = jest.fn();
    await middleware(socket as never, next);
    return { socket, error: next.mock.calls[0][0] as Error | undefined };
  };
  return { connect };
}

describe('RealtimeGateway: koneksi memeriksa akun ke database', () => {
  it('akun dinonaktifkan: ditolak walau tokennya belum kedaluwarsa', async () => {
    const { connect } = setup({ active: false, role: 'admin', passwordChangedAt: null });
    expect((await connect()).error).toBeDefined();
  });

  it('password diganti sesudah token terbit: ditolak', async () => {
    const { connect } = setup({ active: true, role: 'admin', passwordChangedAt: new Date((iat + 60) * 1000) });
    expect((await connect()).error).toBeDefined();
  });

  it('akun sah: diterima, peran diambil dari database bukan dari token', async () => {
    const { connect } = setup({ active: true, role: 'teknisi', passwordChangedAt: null });
    const { socket, error } = await connect();
    expect(error).toBeUndefined();
    expect(socket.data.user?.role).toBe('teknisi');
  });
});
