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
import {
  MarketplaceHomeQueryDto,
  MarketplaceListQueryDto,
} from './marketplace.dto.js';
import { MarketplaceService } from './marketplace.service.js';

@ApiTags('Customer Marketplace')
@Controller({ path: 'customer/marketplace', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

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
  @ApiOperation({ summary: 'List customer-visible grades' })
  async listGrades(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketplaceListQueryDto,
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
}
