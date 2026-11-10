import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

// @nestjs/schedule ESM-only; terseret lewat reminders. Cron tidak dipakai di test ini.
jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

describe('InvoicesService.sendWhatsapp — invoice batal', () => {
  it('invoice batal tidak dikirim ke pelanggan', async () => {
    const prisma: any = {
      invoice: {
        findUnique: jest.fn(async () => ({ id: 'i1', status: 'batal', items: [], member: null, adjustments: [], customerPhone: '0812' })),
      },
    };
    const whatsapp: any = { sendInvoiceMessage: jest.fn() };
    const svc = new InvoicesService(prisma, whatsapp, {} as any, {} as any, {} as any);
    await expect(svc.sendWhatsapp('i1', 'a1')).rejects.toThrow(BadRequestException);
    await expect(svc.sendWhatsapp('i1', 'a1')).rejects.toThrow('dibatalkan');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
  });
});
