import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { UndianService } from './undian.service';
import { CreateUndianDto } from './dto/create-undian.dto';
import { UpdateParticipantsDto } from './dto/update-participants.dto';

// Semua aksi undian admin-only, sama kayak assert_caller_role di RPC aslinya.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('undian')
export class UndianController {
  constructor(private readonly undian: UndianService) {}

  @Get()
  findAll() {
    return this.undian.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.undian.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUndianDto, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.create(dto, user.sub);
  }

  @Put(':id/participants')
  updateParticipants(
    @Param('id') id: string,
    @Body() dto: UpdateParticipantsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.undian.updateParticipants(id, dto, user.sub);
  }

  @Post(':id/draw')
  draw(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.draw(id, user.sub);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.cancel(id, user.sub);
  }
}
