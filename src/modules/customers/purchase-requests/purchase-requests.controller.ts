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
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreatePurchaseRequestDto,
  CustomerCounterOfferDto,
  CustomerPurchaseRequestQueryDto,
} from './purchase-requests.dto.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@ApiTags('Customer Purchase Requests')
@Controller({ path: 'customer/purchase-requests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create purchase request(s) from cart (one PR per seller org)',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.create(user.id, dto),
      'Purchase request(s) created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List customer purchase requests' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerPurchaseRequestQueryDto,
  ) {
    const { items, meta } = await this.purchaseRequestsService.findAll(
      user.id,
      query,
    );
    return successResponse(items, 'Purchase requests retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase request' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.findOne(user.id, id),
      'Purchase request retrieved',
    );
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get purchase request status' })
  async status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.status(user.id, id),
      'Purchase request status',
    );
  }

  @Get(':id/negotiation')
  @ApiOperation({ summary: 'Blind negotiation history' })
  async negotiation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.negotiation(user.id, id),
      'Negotiation history',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel purchase request' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.cancel(user.id, id),
      'Purchase request cancelled',
    );
  }

  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit customer counter-offer' })
  async counter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerCounterOfferDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.counter(user.id, id, dto),
      'Customer counter-offer submitted',
    );
  }

  @Post(':id/accept-counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept latest seller counter-offer → creates PO' })
  async acceptCounter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.acceptCounter(user.id, id),
      'Counter-offer accepted',
    );
  }

  @Post(':id/reject-counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject latest seller counter-offer' })
  async rejectCounter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.rejectCounter(user.id, id),
      'Counter-offer rejected',
    );
  }
}
