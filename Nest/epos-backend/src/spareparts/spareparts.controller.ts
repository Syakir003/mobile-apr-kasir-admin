import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
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
  findAll() {
    return this.spareparts.findAll();
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.spareparts.search(q ?? '');
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
