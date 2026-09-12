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
import {
  AdminListQueryDto,
  AdminReasonDto,
} from '../common/admin-query.dto.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import { AdminPricingService } from './admin-pricing.service.js';

@ApiTags('Admin Pricing')
@Controller({ path: 'admin/pricing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminPricingController {
  constructor(private readonly pricing: AdminPricingService) {}

  @Get('offers')
  @ApiOperation({ summary: 'Offers with recent price revisions' })
  async offers(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.pricing.listOffers(query);
    return successResponse(items, 'Pricing offers retrieved', meta);
  }

  @Get('history')
  @ApiOperation({ summary: 'Price revision history' })
  async history(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.pricing.history(query);
    return successResponse(items, 'Price revision history', meta);
  }

  @Get('revision-requests')
  @ApiOperation({ summary: 'Pending price revision requests' })
  async revisionRequests(@Query() query: AdminListQueryDto) {
    const { items, meta } = await this.pricing.revisionRequests(query);
    return successResponse(items, 'Revision requests', meta);
  }

  @Post('revision-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return successResponse(
      await this.pricing.approveRevision(id, user.id, dto),
      'Revision approved',
    );
  }

  @Post('revision-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return successResponse(
      await this.pricing.rejectRevision(id, user.id, dto),
      'Revision rejected',
    );
  }
}
