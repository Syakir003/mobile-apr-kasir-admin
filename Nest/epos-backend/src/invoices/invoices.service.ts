import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RemindersService } from '../reminders/reminders.service';
import { formatTanggalId } from '../whatsapp/wa-format.util';
import { wibDateOnly } from '../common/wib-date.util';
import { InvoiceHistoryQueryDto } from './dto/invoice-history-query.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly reminders: RemindersService,
  ) {}

  /**
   * Halaman "Riwayat Transaksi" — semua invoice (bukan cuma punya 1 member
   * kayak MembersService.findOne, ini lintas member), bisa dicari & difilter.
   * Pola page/pageSize sama kayak TechnicianJobsService.history(). `q` nyari
   * di nomor invoice, nama/HP customer di invoice itu sendiri (customerName/
   * customerPhone — bisa beda dari data member kalau kasir ubah manual pas
   * checkout), MAUPUN nama member yang terhubung.
   */
  async findAll(query: InvoiceHistoryQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const q = query.q?.trim();

    // from/to dari <input type="date"> browser (YYYY-MM-DD, tanpa jam) —
    // diperlakukan inclusive di kedua ujung hari itu. Gak pakai wibDateKey
    // presisi kayak nomor invoice/barcode (itu emang harus presisi WIB
    // karena jadi bagian nomor); di sini cukup rentang filter biasa.
    const from = query.from ? new Date(`${query.from}T00:00:00.000`) : undefined;
    const to = query.to ? new Date(`${query.to}T23:59:59.999`) : undefined;

    const where: Prisma.InvoiceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { customerPhone: { contains: q } },
              { member: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: {
          member: true,
          // Dipakai frontend buat nampilin pilihan "Cetak Surat Jalan" /
          // "Cetak Label Unit" cuma pas emang relevan (invoice yang lahir
          // dari servis/instalasi) — invoice retail biasa (jual sparepart
          // doang tanpa servis) gak punya serviceOrders sama sekali.
          serviceOrders: {
            select: { id: true, _count: { select: { serviceOrderUnits: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * `role` dipakai buat strip `buyPriceSnapshot` (harga beli/margin toko)
   * dari tiap invoice item kalau bukan admin. Fix dari audit: sejak
   * `buyPriceSnapshot` ditambahkan ke InvoiceItem (Siklus 8 revisi, buat
   * akurasi laporan laba-rugi), field itu otomatis ikut ke-serialize di sini
   * juga — endpoint invoice biasa (dibuka buat admin+kasir) jadi bocorin
   * harga beli/margin ke kasir, padahal laporan laba-rugi sengaja
   * admin-only. Kasir tetap liat semua data lain (harga jual, subtotal,
   * pembayaran, dst) — cuma buyPriceSnapshot yang di-strip.
   */
  async findOne(id: string, role: 'admin' | 'kasir' | 'teknisi') {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        adjustments: true,
        manualPayments: { orderBy: { createdAt: 'asc' } },
        member: true,
        // Sama kayak findAll() — dipakai frontend (PrintMenu) buat nentuin
        // pilihan "Cetak Surat Jalan"/"Cetak Label Unit" relevan atau enggak.
        // Ditambahin di sini karena POS sekarang auto-redirect ke halaman
        // detail ini abis checkout (padanan context.go mobile), jadi
        // pilihan cetak yang tadinya cuma ada di banner sukses POS harus
        // tetap kepegang di sini juga.
        serviceOrders: {
          select: { id: true, _count: { select: { serviceOrderUnits: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');
    if (role !== 'admin') {
      return {
        ...invoice,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- idiom "destructure buat dibuang", bukan variabel yang kelupaan
        items: invoice.items.map(({ buyPriceSnapshot, ...item }) => item),
      };
    }
    return invoice;
  }

  /**
   * Tombol "Kirim WA" manual di halaman detail invoice — keputusan user
   * (bukan otomatis pas checkout) biar kasir yang mutusin kapan pelanggan
   * dikirimi. Boleh diklik berkali-kali (resend) — WhatsappLog utk
   * kind='invoice' sengaja gak pakai dedupeKey, beda dari reminder otomatis.
   */
  async sendWhatsapp(invoiceId: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, member: true },
    });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');

    const phone = invoice.customerPhone || invoice.member?.phone;
    if (!phone) {
      throw new BadRequestException(
        'Invoice ini tidak punya nomor HP pelanggan — isi dulu data pelanggan sebelum kirim WA',
      );
    }

    const nama = invoice.customerName || invoice.member?.name || 'Pelanggan';
    const itemLines = invoice.items
      .map((item) => `- ${item.name} x${trimZero(item.qty)} = ${formatRupiah(item.lineTotal)}`)
      .join('\n');
    // Redaksi udah bisa diedit admin lewat halaman "Pengingat WA" -> tab
    // "Template Pesan" (kind='invoice') — lihat RemindersService.renderTemplate().
    const message = await this.reminders.renderTemplate('invoice', {
      nama,
      nomor: invoice.number,
      tanggal: formatTanggalId(wibDateOnly(invoice.createdAt)),
      item: itemLines,
      total: formatRupiah(invoice.grandTotal),
      status: invoiceStatusLabel(invoice.status),
    });

    return this.whatsapp.sendInvoiceMessage({
      invoiceId: invoice.id,
      memberId: invoice.memberId,
      phone,
      message,
      actorId,
    });
  }
}

// `Number(decimal)` sendiri udah otomatis buang trailing zero (2.00 -> 2,
// 1.50 -> 1.5) — dibungkus fungsi kecil di sini cuma biar niatnya jelas di
// pemanggil (qty produk vs harga, dua makna beda).
function trimZero(qty: Prisma.Decimal): string {
  return String(Number(qty));
}

function formatRupiah(value: Prisma.Decimal | number): string {
  return `Rp${Math.round(Number(value)).toLocaleString('id-ID')}`;
}

function invoiceStatusLabel(status: string): string {
  if (status === 'lunas') return 'Lunas';
  if (status === 'dp') return 'DP (belum lunas)';
  return 'Belum Dibayar';
}
