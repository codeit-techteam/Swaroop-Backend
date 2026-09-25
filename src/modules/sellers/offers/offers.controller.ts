import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  BulkOfferIdsDto,
  CreateOfferDto,
  OfferQueryDto,
  UpdateOfferDto,
} from './offers.dto.js';
import { OffersService } from './offers.service.js';

@ApiTags('Seller Offers')
@Controller({ path: 'seller/offers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Post()
  @ApiOperation({ summary: 'Create offer' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOfferDto,
  ) {
    return successResponse(
      await this.offersService.create(user.id, dto),
      'Offer created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List offers' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OfferQueryDto,
  ) {
    const { items, meta } = await this.offersService.findAll(user.id, query);
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Offer KPI summary (active, draft, pending PRs, expiring soon, sold out)',
  })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.offersService.summary(user.id),
      'Offer summary retrieved',
    );
  }

  @Post('bulk-activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk activate offers (per-item results)' })
  async bulkActivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkOfferIdsDto,
  ) {
    return successResponse(
      await this.offersService.bulkActivate(user.id, dto),
      'Bulk activate completed',
    );
  }

  @Post('bulk-pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk pause offers (per-item results)' })
  async bulkPause(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkOfferIdsDto,
  ) {
    return successResponse(
      await this.offersService.bulkPause(user.id, dto),
      'Bulk pause completed',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get offer' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.findOne(user.id, id),
      'Offer retrieved',
    );
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Offer audit history' })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.history(user.id, id),
      'Offer history retrieved',
    );
  }

  @Get(':id/purchase-requests')
  @ApiOperation({ summary: 'Purchase requests linked to this offer' })
  async purchaseRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.purchaseRequestsForOffer(user.id, id),
      'Offer purchase requests retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update offer (supports optimistic concurrency via version)',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferDto,
  ) {
    return successResponse(
      await this.offersService.update(user.id, id, dto),
      'Offer updated',
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Activate offer (DRAFT→PENDING_REVIEW→ACTIVE, or PAUSED→ACTIVE resume)',
  })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.activate(user.id, id),
      'Offer activated',
    );
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume paused offer → ACTIVE' })
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.resume(user.id, id),
      'Offer resumed',
    );
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause offer' })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.pause(user.id, id),
      'Offer paused',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel offer → CLOSED (soft delete)' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.cancel(user.id, id),
      'Offer cancelled',
    );
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Expire offer' })
  async expire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.expire(user.id, id),
      'Offer expired',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete / cancel offer' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.softDelete(user.id, id),
      'Offer deleted',
    );
  }
}
