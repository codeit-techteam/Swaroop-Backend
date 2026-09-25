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
  SellerPriceRevisionAcceptDto,
  SellerPriceRevisionCounterDto,
  SellerPriceRevisionQueryDto,
  SellerPriceRevisionRejectDto,
} from './price-revisions.dto.js';
import { SellerPriceRevisionsService } from './price-revisions.service.js';

@ApiTags('Seller Price Revisions')
@Controller({ path: 'seller/price-revisions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerPriceRevisionsController {
  constructor(private readonly priceRevisions: SellerPriceRevisionsService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Price revision KPI counts for authenticated seller (blind marketplace)',
  })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.priceRevisions.summary(user.id),
      'Price revision summary retrieved',
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'List seller price revisions. Scoped to JWT seller org. Blind buyer DTO.',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerPriceRevisionQueryDto,
  ) {
    const { items, meta } = await this.priceRevisions.list(user.id, query);
    return successResponse(items, 'Price revisions retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get blind price revision detail' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.priceRevisions.findOne(user.id, id),
      'Price revision retrieved',
    );
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: 'Blind negotiation timeline (Anonymous Buyer / Seller / Admin)',
  })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.priceRevisions.timeline(user.id, id),
      'Price revision timeline retrieved',
    );
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept price revision (delegates to PR accept)' })
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SellerPriceRevisionAcceptDto,
  ) {
    return successResponse(
      await this.priceRevisions.accept(user.id, id, dto),
      'Price revision accepted',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject price revision (delegates to PR reject)' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SellerPriceRevisionRejectDto,
  ) {
    return successResponse(
      await this.priceRevisions.reject(user.id, id, dto),
      'Price revision rejected',
    );
  }

  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Counter price revision (delegates to PR counter-offer)',
  })
  async counter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SellerPriceRevisionCounterDto,
  ) {
    return successResponse(
      await this.priceRevisions.counter(user.id, id, dto),
      'Price revision countered',
    );
  }
}
