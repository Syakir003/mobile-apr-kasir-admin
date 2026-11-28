import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ListStatusQueryDto } from '../common/dto/list-status-query.dto';
import { ProductsService } from './products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly notifications: NotificationsService,
  ) {}

  // Gudang hanya mendaftarkan AC: semua harga yang dikirim diabaikan.
  @Roles('admin', 'gudang')
  @Post()
  async create(@Body() dto: CreateProductDto, @CurrentUser() user: CurrentUserPayload) {
    if (user.role === 'admin') return this.products.create(dto, user.sub);

    // Selalu "menunggu harga", kecuali Outdoor paket yang memang Rp0 (harga ada
    // di Indoor-nya).
    const pending = dto.acRole !== 'outdoor';
    const { sellPrice, priceInstaller, priceReseller, priceSingle, ...rest } = dto;
    void [sellPrice, priceInstaller, priceReseller, priceSingle];
    const created = await this.products.create({ ...rest, sellPrice: 0 } as CreateProductDto, user.sub, { pending });
    void this.notifications.notifyRoles(['admin'], {
      title: 'Produk Baru dari Gudang',
      body: pending
        ? `${created.name} menunggu harga jual — belum bisa dijual.`
        : `${created.name} (Outdoor) ditambahkan.`,
      type: 'produk_baru',
    });
    return created;
  }

  @Get()
  findAll(@Query() query: ListStatusQueryDto) {
    return this.products.findAll(query.status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  // `?includePair=1` (Paket AC Split, 2026-09-30) — ikut nyertain batch
  // produk pasangannya (Indoor <-> Outdoor), lihat ProductsService.findBatches.
  @Get(':id/batches')
  findBatches(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('includePair') includePair?: string,
  ) {
    // buyPrice (harga modal) cuma buat admin — kasir juga manggil ini dari
    // dialog pilih batch di POS, margin gak boleh bocor ke kasir/teknisi.
    return this.products.findBatches(id, includePair === '1' || includePair === 'true', user.role === 'admin');
  }

  // Daftar unit fisik + QR (tampilan "Per Unit" di detail produk). Token QR
  // hanya untuk admin & gudang, sama seperti cetak label.
  @Roles('admin', 'gudang')
  @Get(':id/units')
  findUnits(
    @Param('id') id: string,
    @Query('includePair') includePair?: string,
    @Query('status') status?: string,
  ) {
    const allowed = ['di_gudang', 'reserved', 'keluar', 'semua'] as const;
    const picked = allowed.find((s) => s === status) ?? 'di_gudang';
    return this.products.findUnits(id, includePair === '1' || includePair === 'true', picked);
  }

  // Gudang hanya membetulkan identitas barang yang masih menunggu harga.
  @Roles('admin', 'gudang')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return user.role === 'admin'
      ? this.products.update(id, dto, user.sub)
      : this.products.fixPending(id, dto, user.sub);
  }
}
