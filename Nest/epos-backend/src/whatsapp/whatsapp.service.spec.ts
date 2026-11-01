import { BadRequestException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

function setup(log: Record<string, unknown> | null) {
  const prisma = {
    whatsappLog: {
      findUnique: jest.fn().mockResolvedValue(log),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...(log ?? {}), ...data }),
        ),
    },
  };
  const fonnte = {
    send: jest.fn().mockResolvedValue({ ok: true, raw: { status: true } }),
  };
  const service = new WhatsappService(prisma as never, fonnte as never);
  return { service, prisma, fonnte };
}

const failed = (
  kind: string,
  member: { active: boolean; waOptOut: boolean } | null,
) => ({
  id: 'log-1',
  kind,
  status: 'gagal',
  phone: '6281234567890',
  message: 'Halo',
  member,
});

describe('WhatsappService.retry', () => {
  it('pengingat ke pelanggan yang kini opt-out: dibatalkan, tidak dikirim', async () => {
    const { service, prisma, fonnte } = setup(
      failed('reminder_h3', { active: true, waOptOut: true }),
    );

    await expect(service.retry('log-1')).rejects.toThrow(BadRequestException);

    expect(fonnte.send).not.toHaveBeenCalled();
    expect(prisma.whatsappLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: {
        status: 'dibatalkan',
        error: 'Pelanggan meminta tidak dikirimi pesan WhatsApp',
      },
    });
  });

  it('pesan selesai servis ke pelanggan nonaktif: dibatalkan, tidak dikirim', async () => {
    const { service, prisma, fonnte } = setup(
      failed('selesai_servis', { active: false, waOptOut: false }),
    );

    await expect(service.retry('log-1')).rejects.toThrow(
      'Pelanggan sudah nonaktif',
    );

    expect(fonnte.send).not.toHaveBeenCalled();
    expect(prisma.whatsappLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { status: 'dibatalkan', error: 'Pelanggan sudah nonaktif' },
    });
  });

  it('pengingat ke pelanggan yang masih boleh dihubungi: tetap dikirim ulang', async () => {
    const { service, fonnte } = setup(
      failed('reminder_h7', { active: true, waOptOut: false }),
    );

    const res = await service.retry('log-1');

    expect(fonnte.send).toHaveBeenCalledWith('6281234567890', 'Halo');
    expect(res.status).toBe('terkirim');
  });

  it('invoice dikirim manual kasir: tidak ikut dicek opt-out', async () => {
    const { service, fonnte } = setup(
      failed('invoice', { active: true, waOptOut: true }),
    );

    await service.retry('log-1');

    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it('log tidak ditemukan: error dari dispatch (404)', async () => {
    const { service } = setup(null);

    await expect(service.retry('nope')).rejects.toThrow(
      'Log WhatsApp tidak ditemukan',
    );
  });
});
