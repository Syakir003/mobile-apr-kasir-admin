import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ListStatusQueryDto } from '../common/dto/list-status-query.dto';
import { SparepartsService } from './spareparts.service';
import { hasPackSale } from './sparepart-mode.util';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('spareparts')
export class SparepartsController {
  constructor(
    private readonly spareparts: SparepartsService,
    private readonly notifications: NotificationsService,
  ) {}

  // Gudang boleh menambah barang yang langsung bisa dijual: hanya harga Ritel.
  // Harga tipe pembeli lain tetap urusan admin, stok masuk lewat /stock/in
  // (supaya ada mutasi & modalnya masuk daftar "belum diisi").
  @Roles('admin', 'gudang')
  @Post()
  async create(@Body() dto: CreateSparepartDto, @CurrentUser() user: CurrentUserPayload) {
    if (user.role === 'admin') return this.spareparts.create(dto, user.sub);

    // Harga boleh kosong: disimpan "menunggu harga" (tidak aktif) sampai admin mengisi.
    const pending =
      !(dto.sellPrice > 0) ||
      (hasPackSale(dto.trackingMode ?? 'biasa') && !((dto.sellPricePack ?? 0) > 0));
    const { priceInstaller, priceReseller, pricePackInstaller, pricePackReseller, ...rest } = dto;
    void [priceInstaller, priceReseller, pricePackInstaller, pricePackReseller];
    const created = await this.spareparts.create({ ...rest, stock: 0 }, user.sub, { pending });
    void this.notifications.notifyRoles(['admin'], {
      title: 'Sparepart Baru dari Gudang',
      body: pending
        ? `${created.name} menunggu harga jual — belum bisa dijual.`
        : `${created.name} sudah bisa dijual. Periksa harga jualnya.`,
      type: 'sparepart_baru',
    });
    return created;
  }

  @Get()
  findAll(@Query() query: ListStatusQueryDto) {
    return this.spareparts.findAll(query.status);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.spareparts.search(q ?? '');
  }

  @Get(':id/batches')
  async findBatches(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    const batches = await this.spareparts.findBatches(id);
    // Harga modal (buyPrice) cuma buat admin — sama seperti ProductsController.findBatches.
    return user.role === 'admin' ? batches : batches.map(({ buyPrice, ...rest }) => rest);
  }

  // Gudang hanya membetulkan identitas barang yang masih menunggu harga.
  @Roles('admin', 'gudang')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSparepartDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return user.role === 'admin'
      ? this.spareparts.update(id, dto, user.sub)
      : this.spareparts.fixPending(id, dto, user.sub);
  }
}
