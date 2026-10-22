import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { buildMarketplaceEstimate } from '../checkout/marketplace-estimate.js';
import {
  MarketplaceGradeQueryDto,
  MarketplaceHomeQueryDto,
  MarketplaceListQueryDto,
} from '../marketplace/marketplace.dto.js';
import { MarketplaceService } from '../marketplace/marketplace.service.js';
import { CustomerOfferQueryDto } from '../offers/offers.dto.js';
import { OffersService } from '../offers/offers.service.js';
import { CustomerProductQueryDto } from '../products/products.dto.js';
import { ProductsService } from '../products/products.service.js';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;

class PublicEstimateDto {
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

/**
 * Guest-readable marketplace. Blind payloads only — no cart, checkout,
 * document downloads, invoices, or account-specific prices.
 */
@ApiTags('Public Marketplace')
@Controller({ path: 'public/marketplace', version: '1' })
export class PublicMarketplaceController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly products: ProductsService,
    private readonly offers: OffersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Guest marketplace home' })
  async home(@Query() query: MarketplaceHomeQueryDto) {
    return successResponse(
      await this.marketplace.home(null, query),
      'Marketplace home',
    );
  }

  @Get('categories')
  async categories() {
    return successResponse(
      await this.marketplace.listCategories(null),
      'Categories retrieved',
    );
  }

  @Get('grades')
  async grades(@Query() query: MarketplaceGradeQueryDto) {
    const { items, meta } = await this.marketplace.listGrades(null, query);
    return successResponse(items, 'Grades retrieved', meta);
  }

  @Get('grades/:id')
  async grade(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.marketplace.getGrade(null, id),
      'Grade retrieved',
    );
  }

  @Get('grades/:id/products')
  async gradeProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarketplaceListQueryDto,
  ) {
    const { items, meta } = await this.marketplace.listGradeProducts(
      null,
      id,
      query,
    );
    return successResponse(items, 'Products retrieved', meta);
  }

  @Get('grades/:id/offers')
  async gradeOffers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MarketplaceListQueryDto,
  ) {
    const { items, meta } = await this.marketplace.listGradeOffers(
      null,
      id,
      query,
    );
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get('grades/:id/tds')
  @ApiOperation({
    summary:
      'TDS document metadata for products under this grade. Download still requires authentication.',
  })
  async gradeTds(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.products.listGradeTdsDocuments(null, id),
      'Grade TDS documents',
    );
  }

  @Get('products')
  async listProducts(@Query() query: CustomerProductQueryDto) {
    const { items, meta } = await this.products.findAll(null, query);
    return successResponse(items, 'Products retrieved', meta);
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    return successResponse(
      await this.products.findOne(null, id),
      'Product retrieved',
    );
  }

  @Get('products/:id/documents')
  @ApiOperation({
    summary:
      'List document metadata (TDS etc.). Download URLs require authentication.',
  })
  async productDocuments(@Param('id') id: string) {
    return successResponse(
      await this.products.listDocuments(null, id),
      'Product documents retrieved',
    );
  }

  @Get('products/:id/offers')
  async productOffers(
    @Param('id') id: string,
    @Query() query: CustomerProductQueryDto,
  ) {
    const { items, meta } = await this.products.listOffers(null, id, query);
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get('offers')
  async listOffers(@Query() query: CustomerOfferQueryDto) {
    const { items, meta } = await this.offers.findAll(null, query);
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get('offers/:id')
  async offer(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.offers.findOne(null, id),
      'Offer retrieved',
    );
  }

  @Post('pricing/estimate')
  @ApiOperation({
    summary:
      'Non-binding landed-cost estimate from authoritative offer price (no quote persistence). Foreign currencies are not converted to INR.',
  })
  async estimate(@Body() dto: PublicEstimateDto) {
    const estimate = await buildMarketplaceEstimate(this.prisma, dto);
    const message =
      estimate.currency !== 'INR'
        ? 'Estimate (foreign currency — no INR conversion)'
        : 'Estimate';
    return successResponse(estimate, message);
  }
}
