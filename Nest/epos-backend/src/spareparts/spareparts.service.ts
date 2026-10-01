import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ListStatus } from '../common/dto/list-status-query.dto';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';
import { resolveSparepartMode } from './sparepart-mode.util';

@Injectable()
export class SparepartsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Siklus sparepart-per-gulungan (2026-09-23) — sparepart batchTracked
   * WAJIB mulai dari stok 0. Kalau dibolehin isi `stock` langsung di sini,
   * `Sparepart.stock` (mirror) bakal nonzero TANPA baris `item_costs` yang
   * mendukungnya ("stok phantom") — checkout/markUsed bakal gagal "stok
   * tidak cukup" walau UI nunjuk ada stok, dan gak ada jalur recovery lewat
   * opname (opname batch-tracked wajib nunjuk itemCostId yang gak pernah
   * ada). Solusinya: paksa stok awal masuk lewat alur barang-masuk beneran
   * (bikin baris item_costs), bukan field ini. */
  /** SKU kosong/spasi doang => null (kolom unik, '' kedua bakal bentrok).
   * SKU terisi => pastikan belum dipakai sparepart lain, dan sebut siapa
   * pemakainya biar admin langsung tau (bukan error database mentah). */
  private async normalizeSku(sku: string | undefined, exceptId?: string): Promise<string | null | undefined> {
    if (sku === undefined) return undefined;
    const clean = sku.trim();
    if (!clean) return null;
    const taken = await this.prisma.sparepart.findFirst({
      where: { sku: clean, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true, active: true },
    });
    if (taken) {
      throw new ConflictException(
        `SKU "${clean}" sudah dipakai sparepart "${taken.name}"${taken.active ? '' : ' (nonaktif)'}. Gunakan SKU lain atau kosongkan.`,
      );
    }
    return clean;
  }

  async create(dto: CreateSparepartDto) {
    // Mode utuh/eceran (2026-09-30) — batchTracked diturunin dari
    // trackingMode (gulungan/gabungan => true), field kemasan divalidasi.
    const mode = resolveSparepartMode(dto);
    if (mode.batchTracked && dto.stock > 0) {
      throw new BadRequestException(
        'Sparepart per-gulungan gak bisa punya stok awal saat dibuat — tambahkan gulungan pertama lewat menu Barang Masuk setelah sparepart ini dibuat.',
      );
    }
    const { trackingMode: _tm, batchTracked: _bt, packUnit: _pu, packSize: _ps, sellPricePack: _sp, ...rest } = dto;
    void [_tm, _bt, _pu, _ps, _sp];
    const sku = await this.normalizeSku(dto.sku);
    return this.prisma.sparepart.create({
      data: { ...rest, sku, ...mode, active: true },
    });
  }

  // BARU (2026-09-25, fitur nonaktifkan Master Data) — `status` opsional,
  // default 'active'. `search()` di bawah SENGAJA gak ikut diubah — tetap
  // hardcode active-only, dipakai autocomplete POS/teknisi yang emang cuma
  // boleh nunjukin sparepart yang aktif.
  findAll(status: ListStatus = 'active') {
    const where = status === 'all' ? {} : { active: status === 'inactive' ? false : true };
    return this.prisma.sparepart.findMany({ where, orderBy: { name: 'asc' } });
  }

  /** Dipakai autocomplete input sparepart teknisi (requirement eksplisit). */
  search(query: string) {
    return this.prisma.sparepart.findMany({
      where: { active: true, name: { contains: query, mode: 'insensitive' } },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }

  /** List batch/gulungan AKTIF (stock>0) 1 sparepart batch-tracked — dipakai
   * halaman detail sparepart (tabel "gulungan aktif") & referensi harga pas
   * barang masuk lagi. Urut TERTUA dulu, konsisten sama urutan FIFO di
   * StockLockingService.lockAndDeduct. Sama pola persis kayak
   * ProductsService.findBatches — dipisah di sini (bukan di-share) karena
   * beda entity induk (Sparepart vs Product), walau query-nya mirip.
   *
   * Siklus sparepart-per-gulungan (2026-09-23). */
  async findBatches(sparepartId: string) {
    const sparepart = await this.prisma.sparepart.findUnique({ where: { id: sparepartId } });
    if (!sparepart) throw new NotFoundException('Sparepart tidak ditemukan');
    return this.prisma.itemCost.findMany({
      where: { kind: 'sparepart', refId: sparepartId, stock: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Edit sparepart setelah dibuat — sama alasannya kayak ProductsService.update. */
  async update(id: string, dto: UpdateSparepartDto, actorId: string) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Gak ada perubahan yang dikirim');
    }
    const existing = await this.prisma.sparepart.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sparepart tidak ditemukan');

    // Siklus sparepart-per-gulungan (2026-09-23) — sama alasan kayak guard
    // di create(): toggle false->true selagi masih ada stok flat bakal
    // nyisain Sparepart.stock phantom yang gak ada item_costs-nya.
    const modeTouched =
      dto.trackingMode !== undefined ||
      dto.batchTracked !== undefined ||
      dto.packUnit !== undefined ||
      dto.packSize !== undefined ||
      dto.sellPricePack !== undefined;
    const mode = modeTouched
      ? resolveSparepartMode(dto, {
          trackingMode: existing.trackingMode,
          batchTracked: existing.batchTracked,
          packUnit: existing.packUnit,
          packSize: existing.packSize === null ? null : Number(existing.packSize),
          sellPricePack: existing.sellPricePack === null ? null : Number(existing.sellPricePack),
        })
      : null;

    if (mode && mode.batchTracked && !existing.batchTracked && Number(existing.stock) > 0) {
      throw new BadRequestException(
        `Gak bisa aktifkan pelacakan per-gulungan selagi masih ada stok flat (${existing.stock} ${existing.unit}) — nolkan dulu stoknya lewat opname, baru aktifkan pelacakan per-gulungan.`,
      );
    }

    const { trackingMode: _tm, batchTracked: _bt, packUnit: _pu, packSize: _ps, sellPricePack: _sp, ...rest } = dto;
    void [_tm, _bt, _pu, _ps, _sp];
    const sku = await this.normalizeSku(dto.sku, id);
    const sparepart = await this.prisma.sparepart.update({
      where: { id },
      data: { ...rest, ...(sku !== undefined ? { sku } : {}), ...(mode ?? {}) },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUid: actorId,
        action: 'sparepart.update',
        target: id,
        detail: { ...dto, ...(mode ? { resolvedMode: mode.trackingMode } : {}) },
      },
    });

    return sparepart;
  }
}
