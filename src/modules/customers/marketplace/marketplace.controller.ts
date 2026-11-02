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
import { GradeTdsService } from '../../tds/grade-tds.service.js';
import { buildMarketplaceEstimate } from '../checkout/marketplace-estimate.js';
import { CustomerContextService } from '../common/customer-context.service.js';
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
    private readonly gradeTdsService: GradeTdsService,
    private readonly customerContext: CustomerContextService,
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
      'Verified grade-level TDS metadata (independent of live offers). Download uses the grade TDS URL endpoint.',
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

  @Get('grades/:gradeId/tds/:documentId/url')
  @ApiOperation({ summary: 'Signed download URL for a verified grade TDS' })
  async gradeTdsUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('gradeId', ParseUUIDPipe) gradeId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.gradeTdsService.getDownloadUrl(gradeId, documentId, user.id),
      'TDS download URL',
    );
  }

  @Post('grades/:gradeId/tds-requests')
  @ApiOperation({ summary: 'Request TDS when none is verified for the grade' })
  async requestGradeTds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('gradeId', ParseUUIDPipe) gradeId: string,
    @Body() body: { message?: string },
  ) {
    const ctx = await this.customerContext.getOrCreateCustomer(user.id);
    return successResponse(
      await this.gradeTdsService.createRequest({
        userId: user.id,
        customerProfileId: ctx.customerProfileId,
        gradeId,
        message: body?.message,
      }),
      'TDS request created',
    );
  }

  @Get('tds-requests')
  @ApiOperation({ summary: 'List current customer TDS requests' })
  async listTdsRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { items, meta } = await this.gradeTdsService.listCustomerRequests(
      user.id,
      Number(page) || 1,
      Number(limit) || 20,
    );
    return successResponse(items, 'TDS requests', meta);
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
