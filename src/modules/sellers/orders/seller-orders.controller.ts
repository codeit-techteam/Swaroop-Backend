import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { SellerOrdersQueryDto } from './seller-orders.dto.js';
import { SellerOrdersService } from './seller-orders.service.js';

@ApiTags('Seller Orders')
@Controller({ path: 'seller/orders', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerOrdersController {
  constructor(private readonly orders: SellerOrdersService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Order summary counts for the authenticated seller (PurchaseOrder projection)',
  })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.orders.summary(user.id),
      'Order summary retrieved',
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'List seller orders (PurchaseOrder). Scoped to JWT seller org. Blind buyer.',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerOrdersQueryDto,
  ) {
    const { items, meta } = await this.orders.list(user.id, query);
    return successResponse(items, 'Orders retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get seller order detail (own PurchaseOrders only, blind buyer)',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.orders.findOne(user.id, id),
      'Order retrieved',
    );
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary:
      'Seller-safe order timeline from PR/PO/payment/dispatch/shipment events',
  })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.orders.timeline(user.id, id),
      'Order timeline retrieved',
    );
  }
}
