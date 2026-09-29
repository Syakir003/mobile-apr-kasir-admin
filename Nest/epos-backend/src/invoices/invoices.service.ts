import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatTanggalId, waPhone } from '../common/wa-format.util';
import { MembersService } from '../members/members.service';
import { CountersService } from '../counters/counters.service';
import { wibDateOnly } from '../common/wib-date.util';
import { computeTotals, formatInvoiceNumber } from '../pos/pos-calc.util';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { InvoiceHistoryQueryDto } from './dto/invoice-history-query.dto';
import { CreateManualInvoiceDto } from './dto/create-manual-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly counters: CountersService,
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

  /**
   * Fitur "Input Transaksi Manual" (admin) — bukan checkout POS beneran,
   * murni buat migrasi data histori: transaksi & member yang udah ada dari
   * SEBELUM sistem ini jalan. Beda mendasar dari PosService.checkout:
   *  - TIDAK sentuh stok sama sekali (tidak lewat StockLockingService, tidak
   *    bikin StockMovement) — barangnya emang udah kejual lama sebelum
   *    stok di sistem ini diisi, jadi motong stok sekarang cuma bakal bikin
   *    stok jadi salah/minus.
   *  - TIDAK bikin baris `Transaction`/`TransactionItem` — dua tabel itu
   *    representasi "kejadian checkout" (dipakai StockMovement.transactionId
   *    dkk), sedangkan Invoice.transactionId sendiri sudah nullable justru
   *    buat kasus kayak gini. Langsung bikin Invoice + InvoiceItem.
   *  - Baris item BEBAS ketik nama (kind='manual', refId null) — bukan
   *    dipilih dari katalog produk/sparepart, karena barangnya mungkin udah
   *    gak ada lagi di master data sekarang.
   *  - `createdAt` invoice DIPAKSA ke tanggal transaksi ASLI (dto.date),
   *    bukan `now()` — biar invoice ini nongol di laporan/riwayat pada
   *    tanggal yang bener, bukan numpuk di "hari ini". Jam dipatok siang
   *    (12:00 WIB) — cuma tanggalnya yang penting di sini, bukan jam
   *    presisi (data lama gak akan punya jam checkout yang akurat).
   */
  async createManual(dto: CreateManualInvoiceDto, actorId: string) {
    const hasExistingMember = !!dto.memberId;
    const hasNewMember = !!dto.newMember;
    if (hasExistingMember === hasNewMember) {
      // XOR manual — class-validator gak punya built-in buat "wajib salah
      // satu, gak boleh dua-duanya, gak boleh kosong dua-duanya".
      throw new BadRequestException(
        'Wajib isi salah satu: pilih member yang sudah ada ATAU isi data member baru (tidak boleh keduanya/kosong)',
      );
    }

    // Validasi tiap baris SEBELUM itung total — diskon per-baris yang
    // melebihi harga barisnya sendiri bikin lineTotal negatif (kelas bug
    // yang sama kayak K-1 di audit backend: diskon gak divalidasi vs
    // nilai barisnya sendiri).
    for (const item of dto.items) {
      const lineDiscount = item.discount ?? 0;
      if (lineDiscount > item.qty * item.unitPrice) {
        throw new BadRequestException(
          `Diskon baris "${item.name}" melebihi nilai barisnya sendiri`,
        );
      }
    }

    const totals = computeTotals(
      dto.items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, discount: i.discount })),
      dto.discount ?? 0,
      0, // Manual entry gak butuh PPN — data lampau, disederhanakan.
      dto.transportFee ?? 0,
    );
    if (dto.discount && dto.discount > totals.subtotal) {
      throw new BadRequestException('Diskon melebihi subtotal transaksi');
    }
    if (totals.grandTotal < 0) {
      throw new BadRequestException('Total transaksi tidak boleh negatif');
    }
    const totalPaid = dto.totalPaid ?? 0;
    if (totalPaid > totals.grandTotal) {
      throw new BadRequestException('Jumlah dibayar tidak boleh melebihi total transaksi');
    }

    const createdAt = new Date(`${dto.date}T12:00:00.000+07:00`);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException('Format tanggal tidak valid (pakai YYYY-MM-DD)');
    }
    const dateKey = this.counters.dateKey(createdAt);
    const status = computeInvoiceStatus(totals.grandTotal, totalPaid);

    return this.prisma.$transaction(async (tx) => {
      const member = dto.memberId
        ? await tx.member.findUnique({ where: { id: dto.memberId } })
        : (await this.members.findOrCreate(tx, dto.newMember!.name, dto.newMember!.phone, dto.newMember!.address)).member;
      if (!member) throw new NotFoundException('Member tidak ditemukan');

      const invoiceSeq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
      const invoice = await tx.invoice.create({
        data: {
          number: formatInvoiceNumber(dateKey, invoiceSeq),
          memberId: member.id,
          customerName: member.name,
          customerPhone: member.phone,
          subtotal: totals.subtotal,
          discount: dto.discount ?? 0,
          taxPercent: 0,
          taxAmount: 0,
          transportFee: dto.transportFee ?? 0,
          grandTotal: totals.grandTotal,
          totalPaid,
          status,
          notes: dto.notes ?? 'Input manual — data transaksi lampau',
          createdById: actorId,
          createdAt,
        },
      });

      for (const item of dto.items) {
        const lineDiscount = item.discount ?? 0;
        const lineTotal = Math.round(item.qty * item.unitPrice) - lineDiscount;
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            kind: 'manual',
            refId: null,
            name: item.name,
            unit: item.unit ?? '',
            qty: item.qty,
            unitPrice: item.unitPrice,
            lineTotal,
            discount: lineDiscount,
            // item.buyPrice sengaja gak disimpan: invoice_items kebaca kasir,
            // harga modal di sini bocorin margin (lihat migrasi 0036).
          },
        });
      }

      if (totalPaid > 0) {
        await tx.manualPayment.create({
          data: {
            invoiceId: invoice.id,
            method: 'tunai',
            amount: totalPaid,
            note: 'Input manual — pembayaran transaksi lampau',
            createdById: actorId,
            createdAt,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'invoices.manual_create',
          target: invoice.id,
          detail: {
            number: invoice.number,
            grandTotal: totals.grandTotal,
            totalPaid,
            memberId: member.id,
            tanggalAsli: dto.date,
          },
        },
      });

      return tx.invoice.findUnique({
        where: { id: invoice.id },
        include: { items: true, member: true },
      });
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
