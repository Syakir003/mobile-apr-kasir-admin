import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembersService } from '../members/members.service';
import { AcUnitsService } from '../ac-units/ac-units.service';
import { InvoicesService } from '../invoices/invoices.service';
import { LegacyImportDto } from './dto/legacy-import.dto';

/**
 * "Input Data Lampau" (admin) — migrasi customer lama sekaligus unit AC-nya
 * (+ transaksi lampau OPSIONAL) dalam SATU transaksi DB. Gagal di tengah =
 * semuanya batal, tidak ada member setengah jadi.
 */
@Injectable()
export class LegacyImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly acUnits: AcUnitsService,
    private readonly invoices: InvoicesService,
  ) {}

  async import(dto: LegacyImportDto, actorId: string) {
    const m = dto.member;
    const hasExisting = !!m.memberId;
    const hasNew = !!m.name?.trim();
    if (hasExisting === hasNew) {
      throw new BadRequestException(
        'Pilih member yang sudah ada ATAU isi data member baru (tidak boleh keduanya/kosong).',
      );
    }
    if (dto.units.length === 0 && !dto.invoice) {
      throw new BadRequestException('Isi minimal satu unit AC atau satu transaksi lampau.');
    }
    if (dto.invoice && dto.invoice.items.length === 0) {
      throw new BadRequestException('Transaksi lampau butuh minimal satu item.');
    }
    // Validasi invoice (tanpa DB) SEBELUM transaksi dibuka.
    const prepared = dto.invoice ? this.invoices.prepareManual(dto.invoice) : null;

    return this.prisma.$transaction(async (tx) => {
      let member;
      let memberIsNew = false;
      if (m.memberId) {
        member = await tx.member.findUnique({ where: { id: m.memberId } });
        if (!member) throw new NotFoundException('Member tidak ditemukan');
        const newAddress = m.address?.trim();
        if (newAddress && newAddress !== member.address) {
          member = await tx.member.update({ where: { id: member.id }, data: { address: newAddress } });
        }
      } else {
        const res = await this.members.findOrCreate(tx, m.name!.trim(), m.phone ?? '', m.address?.trim());
        member = res.member;
        memberIsNew = res.isNew;
        if (m.customerType && res.isNew) {
          member = await tx.member.update({ where: { id: member.id }, data: { customerType: m.customerType } });
        }
        if (!res.isNew && m.address?.trim() && !member.address) {
          member = await tx.member.update({ where: { id: member.id }, data: { address: m.address.trim() } });
        }
      }

      if (dto.units.some((u) => u.mode === 'qr_dulu') && !member.address?.trim()) {
        throw new BadRequestException(
          'Alamat member wajib diisi untuk unit mode "QR dulu" — alamat tercetak di label supaya teknisi tahu tujuannya.',
        );
      }

      const units: Awaited<ReturnType<AcUnitsService['createLegacy']>>[] = [];
      for (const u of dto.units) {
        units.push(await this.acUnits.createLegacy(tx, member.id, u));
      }
      if (units.length) {
        await tx.member.update({
          where: { id: member.id },
          data: { totalAcUnits: { increment: units.length } },
        });
      }

      const invoice =
        dto.invoice && prepared
          ? await this.invoices.insertManualInvoiceTx(tx, dto.invoice, prepared, member, actorId)
          : null;

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'legacy_import.create',
          target: member.id,
          detail: {
            memberIsNew,
            unitCount: units.length,
            unitModes: dto.units.map((u) => u.mode),
            invoiceNumber: invoice?.number ?? null,
          },
        },
      });

      return {
        member: { id: member.id, name: member.name, phone: member.phone, address: member.address },
        memberIsNew,
        units: units.map((u) => ({
          id: u.id,
          barcodeValue: u.barcodeValue,
          status: u.status,
          brand: u.brand,
          model: u.model,
          roomLocation: u.roomLocation,
        })),
        invoice: invoice ? { id: invoice.id, number: invoice.number } : null,
      };
    });
  }
}
