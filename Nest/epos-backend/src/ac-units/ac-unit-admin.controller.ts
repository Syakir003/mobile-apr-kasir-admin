import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AcUnitLabelsService } from './ac-unit-labels.service';
import { AcUnitCorrectionsService } from './ac-unit-corrections.service';
import { UnitLabelIdsDto, UnitLabelsQueryDto } from './dto/unit-labels-query.dto';
import { ReviewCorrectionDto } from './dto/submit-correction.dto';

class CorrectionsQueryDto {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/**
 * Label QR unit AC + review koreksi data (Input Data Lampau). Base path
 * sengaja BUKAN `ac-units/...` supaya tidak bentrok dengan `GET ac-units/:id`.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AcUnitAdminController {
  constructor(
    private readonly labels: AcUnitLabelsService,
    private readonly corrections: AcUnitCorrectionsService,
  ) {}

  @Roles('admin', 'kasir')
  @Get('unit-labels')
  listLabels(@Query() query: UnitLabelsQueryDto) {
    return this.labels.list(query);
  }

  /** ids dipisah koma, mis. ?ids=a,b,c (maks 100). */
  @Roles('admin', 'kasir')
  @Get('unit-labels/data')
  labelData(@Query('ids') ids = '') {
    return this.labels.labelData(ids.split(','));
  }

  @Roles('admin', 'kasir')
  @Post('unit-labels/mark-printed')
  markPrinted(@Body() dto: UnitLabelIdsDto) {
    return this.labels.markPrinted(dto.ids);
  }

  @Roles('admin')
  @Post('unit-labels/mark-attached')
  markAttached(@Body() dto: UnitLabelIdsDto) {
    return this.labels.markAttached(dto.ids);
  }

  @Roles('admin')
  @Get('unit-corrections')
  listCorrections(@Query() q: CorrectionsQueryDto) {
    return this.corrections.list(q.status, q.page, q.pageSize);
  }

  @Roles('admin')
  @Post('unit-corrections/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ReviewCorrectionDto, @CurrentUser() user: CurrentUserPayload) {
    return this.corrections.approve(id, user.sub, dto.reviewNote);
  }

  @Roles('admin')
  @Post('unit-corrections/:id/reject')
  reject(@Param('id') id: string, @Body() dto: ReviewCorrectionDto, @CurrentUser() user: CurrentUserPayload) {
    return this.corrections.reject(id, user.sub, dto.reviewNote);
  }
}
