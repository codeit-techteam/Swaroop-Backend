import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import {
  AdminOfferActionDto,
  AdminOffersQueryDto,
} from './admin-offers.dto.js';
import { AdminOffersService } from './admin-offers.service.js';

@ApiTags('Admin Offers')
@Controller({ path: 'admin/offers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminOffersController {
  constructor(private readonly offers: AdminOffersService) {}

  @Get()
  @ApiOperation({ summary: 'List all offers' })
  async list(@Query() query: AdminOffersQueryDto) {
    const { items, meta } = await this.offers.list(query);
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Offer detail' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.offers.findOne(id), 'Offer retrieved');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve offer → ACTIVE' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOfferActionDto,
  ) {
    return successResponse(
      await this.offers.approve(id, user.id, dto),
      'Offer approved',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject offer' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOfferActionDto,
  ) {
    return successResponse(
      await this.offers.reject(id, user.id, dto),
      'Offer rejected',
    );
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend offer → PAUSED' })
  async suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminOfferActionDto,
  ) {
    return successResponse(
      await this.offers.suspend(id, user.id, dto),
      'Offer suspended',
    );
  }
}
