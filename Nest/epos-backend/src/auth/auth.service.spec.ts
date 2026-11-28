import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

async function setup() {
  const user = { id: 'u1', role: 'teknisi', active: true, password: await bcrypt.hash('benar123', 4) };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const realtime = { kick: jest.fn() };
  const service = new AuthService(prisma as never, jwt as never, realtime as never);
  return { service, prisma, jwt, realtime };
}

const payload = { sub: 'u1', role: 'teknisi' };

describe('AuthService', () => {
  // 401 berarti "sesi tidak berlaku": web & HP langsung logout. Salah ketik
  // password lama harus 400, supaya pengguna tetap masuk dan bisa mencoba lagi.
  it('password lama salah: 400, bukan 401, dan password tidak diubah', async () => {
    const { service, prisma } = await setup();
    await expect(service.changePassword('u1', 'salah123', 'baru1234')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('login dari HP: sesi 7 hari', async () => {
    const { service, jwt } = await setup();
    await service.login('a@b.c', 'benar123', true);
    expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '7d' });
  });

  it('login web: masa berlaku bawaan (8 jam), tanpa pengecualian', async () => {
    const { service, jwt } = await setup();
    await service.login('a@b.c', 'benar123');
    expect(jwt.signAsync).toHaveBeenCalledWith(payload, undefined);
  });

  it('ganti password dari HP: token pengganti 7 hari, koneksi realtime lama diputus', async () => {
    const { service, jwt, realtime } = await setup();
    await service.changePassword('u1', 'benar123', 'baru1234', true);
    expect(jwt.signAsync).toHaveBeenCalledWith(payload, { expiresIn: '7d' });
    expect(realtime.kick).toHaveBeenCalledWith('u1');
  });
});
