import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { buildMarketplaceEstimate } from '../checkout/marketplace-estimate.js';
import { ProductsService } from '../products/products.service.js';
import {
  MarketplaceGradeQueryDto,
  MarketplaceHomeQueryDto,
  MarketplaceListQueryDto,
} from './marketplace.dto.js';
import { MarketplaceService } from './marketplace.service.js';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;

class CustomerEstimateDto {
  @ApiProperty()
  @IsString()
  offerId!: string;

  @ApiProperty({ example: '10' })
  @IsString()
  @Matches(QTY)
  quantity!: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

@ApiTags('Customer Marketplace')
@Controller({ path: 'customer/marketplace', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly products: ProductsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Marketplace home (categories, grades, featured)' })
  async home(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketplaceHomeQueryDto,
  ) {
    return successResponse(
      await this.marketplaceService.home(user.id, query),
      'Marketplace home',
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'List customer-visible grade categories' })
  async listCategories(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.marketplaceService.listCategories(user.id),
      'Categories retrieved',
    );
  }

  @Get('grades')
  @ApiOperation({
    summary:
      'Browse customer-visible Grade Master (search, category, grade group, manufacturer, live offers)',
  })
  async listGrades(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketplaceGradeQueryDto,
  ) {
    const { items, meta } = await this.marketplaceService.listGrades(
      user.id,
      query,
    );
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get('grades/:id')
  @ApiOperation({ summary: 'Get grade detail' })
  async getGrade(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.marketplaceService.getGrade(user.id, id),
      'Grade retrieved',
    );
  }

  @Get('grades/:id/products')
  @ApiOperation({ summary: 'List products for a grade' })
  async listGradeProducts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarketplaceListQueryDto,
  ) {
    const { items, meta } = await this.marketplaceService.listGradeProducts(
      user.id,
      id,
      query,
    );
    return successResponse(items, 'Grade products retrieved', meta);
  }

  @Get('grades/:id/offers')
  @ApiOperation({ summary: 'List offers for a grade' })
  async listGradeOffers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarketplaceListQueryDto,
  ) {
    const { items, meta } = await this.marketplaceService.listGradeOffers(
      user.id,
      id,
      query,
    );
    return successResponse(items, 'Grade offers retrieved', meta);
  }

  @Get('grades/:id/tds')
  @ApiOperation({
    summary:
      'TDS document metadata for products under this grade. Download still uses product document URL endpoints.',
  })
  async gradeTds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.products.listGradeTdsDocuments(user.id, id),
      'Grade TDS documents',
    );
  }

  @Post('pricing/estimate')
  @ApiOperation({
    summary:
      'Non-binding landed-cost estimate (₹/MT and ₹/kg). Final checkout totals are recalculated server-side.',
  })
  async estimate(@Body() dto: CustomerEstimateDto) {
    const estimate = await buildMarketplaceEstimate(this.prisma, dto);
    const message =
      estimate.currency !== 'INR'
        ? 'Estimate (foreign currency — no INR conversion)'
        : 'Estimate';
    return successResponse(estimate, message);
  }
}
