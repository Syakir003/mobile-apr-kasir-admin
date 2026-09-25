import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { UndianService } from './undian.service';
import { CreateUndianDto, UpdateUndianParticipantsDto } from './dto/undian.dto';

// Admin saja: RLS undian/undian_participants "baca admin" + assert_caller_role
// ['admin'] di semua RPC undian.
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
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.undian.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUndianDto, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.create(user, dto);
  }

  @Put(':id/participants')
  updateParticipants(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUndianParticipantsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.undian.updateParticipants(user, id, dto);
  }

  @Post(':id/draw')
  draw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.draw(user, id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.undian.cancel(user, id);
  }
}
