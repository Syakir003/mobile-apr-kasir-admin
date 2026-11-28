import { UsersService } from './users.service';

function setup() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', role: 'teknisi', active: true }),
      update: jest.fn().mockResolvedValue({ id: 'u1', role: 'teknisi', active: false }),
    },
    auditLog: { create: jest.fn() },
    deviceToken: { deleteMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const realtime = { kick: jest.fn() };
  const service = new UsersService(prisma as never, realtime as never);
  return { service, prisma, realtime };
}

describe('UsersService: mencabut akses perangkat (mis. HP hilang)', () => {
  it('nonaktifkan akun: realtime diputus & token notifikasi dihapus', async () => {
    const { service, prisma, realtime } = setup();
    await service.toggleActive('u1', false, 'admin1');
    expect(realtime.kick).toHaveBeenCalledWith('u1');
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('reset password: sama', async () => {
    const { service, prisma, realtime } = setup();
    await service.resetPassword('u1', 'baru1234', 'admin1');
    expect(realtime.kick).toHaveBeenCalledWith('u1');
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('ganti peran: realtime diputus supaya keluar dari saluran admin', async () => {
    const { service, realtime } = setup();
    await service.update('u1', { role: 'kasir' }, 'admin1');
    expect(realtime.kick).toHaveBeenCalledWith('u1');
  });

  it('ganti nama saja: tidak diputus', async () => {
    const { service, realtime } = setup();
    await service.update('u1', { displayName: 'Baru' }, 'admin1');
    expect(realtime.kick).not.toHaveBeenCalled();
  });

  it('mengaktifkan kembali: tidak memutus apa pun', async () => {
    const { service, prisma, realtime } = setup();
    await service.toggleActive('u1', true, 'admin1');
    expect(realtime.kick).not.toHaveBeenCalled();
    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
  });
});
