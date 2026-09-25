import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatTanggalId, waPhone } from '../common/wa-format.util';
import { wibDateOnly } from '../common/wib-date.util';
import { InvoiceHistoryQueryDto } from './dto/invoice-history-query.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

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
   * `role` sebelumnya juga dipakai strip `buyPriceSnapshot` (harga beli/
   * margin toko) dari invoice item buat non-admin — kolom itu TIDAK ADA di
   * schema Supabase (re-baseline), jadi gak ada apa-apa buat di-strip
   * (invoice_items di sini gak nyimpen cost, laporan laba-rugi baca modal
   * dari item_costs langsung). Parameter `role` dipertahankan biar caller
   * (controller) gak perlu berubah kalau fitur snapshot itu diporting balik
   * nanti sebagai migration terpisah.
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
    return invoice;
  }

  /**
   * Tombol "Kirim WA" manual di halaman detail invoice — keputusan user
   * (bukan otomatis pas checkout) biar kasir yang mutusin kapan pelanggan
   * dikirimi. Boleh diklik berkali-kali (resend), tidak butuh dedupe.
   *
   * Ini BUKAN baris wa_outbox: kolom `kind` tabel itu dibatasi CHECK
   * constraint ke pesan pengingat servis + voucher/undian (migrasi
   * 20260815000023 & 20260817000027) — 'invoice' bukan salah satu nilai yang
   * diizinkan, dan migrasi tidak boleh disentuh dari sini. Invoice memang
   * selalu murni fitur Nest tanpa RPC Supabase, jadi pesannya disusun
   * langsung di sini dan hasilnya (nomor + teks) dikembalikan ke FE supaya FE
   * yang membuka wa.me — sejalan dengan desain "Nest tidak mengirim WA
   * sendiri" (lihat wa-outbox.service.ts).
   */
  async sendWhatsapp(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, member: true },
    });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');

    const phone = waPhone(invoice.customerPhone || invoice.member?.phone);
    if (!phone) {
      throw new BadRequestException(
        'Invoice ini tidak punya nomor HP pelanggan — isi dulu data pelanggan sebelum kirim WA',
      );
    }

    const nama = invoice.customerName || invoice.member?.name || 'Pelanggan';
    const itemLines = invoice.items
      .map((item) => `- ${item.name} x${trimZero(item.qty)} = ${formatRupiah(item.lineTotal)}`)
      .join('\n');
    const message =
      `Halo ${nama}, invoice ${invoice.number} (${invoiceStatusLabel(invoice.status)}) ` +
      `tanggal ${formatTanggalId(wibDateOnly(invoice.createdAt))}:\n${itemLines}\n\n` +
      `Total: ${formatRupiah(invoice.grandTotal)}\n\n— Ayub Podo Rukun`;

    return { phone, message };
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
