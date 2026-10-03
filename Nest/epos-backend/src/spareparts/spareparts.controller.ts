import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ListStatusQueryDto } from '../common/dto/list-status-query.dto';
import { SparepartsService } from './spareparts.service';
import { CreateSparepartDto } from './dto/create-sparepart.dto';
import { UpdateSparepartDto } from './dto/update-sparepart.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('spareparts')
export class SparepartsController {
  constructor(private readonly spareparts: SparepartsService) {}

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateSparepartDto) {
    return this.spareparts.create(dto);
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

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSparepartDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.spareparts.update(id, dto, user.sub);
  }
}
