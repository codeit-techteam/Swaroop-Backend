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
  AcceptPurchaseRequestDto,
  CounterOfferPurchaseRequestDto,
  PurchaseRequestQueryDto,
  RejectPurchaseRequestDto,
  RespondPurchaseRequestDto,
} from './purchase-requests.dto.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@ApiTags('Seller Purchase Requests')
@Controller({ path: 'seller/purchase-requests', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Blind PR inbox (direct + marketplace broadcast)' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PurchaseRequestQueryDto,
  ) {
    const { items, meta } = await this.purchaseRequestsService.findAll(
      user.id,
      query,
    );
    return successResponse(items, 'Purchase requests retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blind PR detail (marks viewed)' })
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
  @ApiOperation({ summary: 'Get PR status, deadline, and allowed actions' })
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
  @ApiOperation({ summary: 'Blind negotiation history (no actor identities)' })
  async negotiation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.negotiation(user.id, id),
      'Negotiation history',
    );
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept purchase request → creates PO' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptPurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.accept(user.id, id, dto),
      'Purchase request accepted',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject purchase request' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.reject(user.id, id, dto),
      'Purchase request rejected',
    );
  }

  @Post(':id/counter-offer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Counter-offer on purchase request' })
  async counterOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CounterOfferPurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.counterOffer(user.id, id, dto),
      'Counter-offer submitted',
    );
  }

  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias of counter-offer' })
  async counter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CounterOfferPurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.counterOffer(user.id, id, dto),
      'Counter-offer submitted',
    );
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force-expire PR if response deadline has passed',
  })
  async expire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.purchaseRequestsService.expire(user.id, id),
      'Purchase request expired',
    );
  }

  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generic respond (ACCEPT/REJECT/COUNTER_OFFER/RESPOND)',
  })
  async respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondPurchaseRequestDto,
  ) {
    return successResponse(
      await this.purchaseRequestsService.respond(user.id, id, dto),
      'Purchase request response recorded',
    );
  }
}
