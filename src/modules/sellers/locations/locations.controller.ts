import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { SetCurrentLocationDto } from '../offers/offers.dto.js';
import { SellerLocationsService } from './locations.service.js';

@ApiTags('Seller Locations')
@Controller({ path: 'seller/locations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerLocationsController {
  constructor(private readonly locationsService: SellerLocationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List seller operating locations (warehouses with inventory/offers)',
  })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.locationsService.list(user.id),
      'Seller locations retrieved',
    );
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current seller operating location' })
  async current(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.locationsService.current(user.id),
      'Current seller location retrieved',
    );
  }

  @Post('current')
  @ApiOperation({ summary: 'Set current seller operating location' })
  async setCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetCurrentLocationDto,
  ) {
    return successResponse(
      await this.locationsService.setCurrent(user.id, dto),
      'Current seller location updated',
    );
  }
}
