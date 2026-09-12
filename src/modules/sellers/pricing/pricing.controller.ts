import {
  Body,
  Controller,
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
  CreatePriceTierDto,
  PricingQueryDto,
  UpdatePriceTierDto,
} from './pricing.dto.js';
import { PricingService } from './pricing.service.js';

@ApiTags('Seller Pricing')
@Controller({ path: 'seller/pricing', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @ApiOperation({ summary: 'List price tiers for seller offers' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PricingQueryDto,
  ) {
    const { items, meta } = await this.pricingService.findAll(user.id, query);
    return successResponse(items, 'Price tiers retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get price tier' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.pricingService.findOne(user.id, id),
      'Price tier retrieved',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create price tier' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceTierDto,
  ) {
    return successResponse(
      await this.pricingService.create(user.id, dto),
      'Price tier created',
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update price tier (creates PriceRevision when parent offer is ACTIVE)',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceTierDto,
  ) {
    return successResponse(
      await this.pricingService.update(user.id, id, dto),
      'Price tier updated',
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark price tier active in offer metadata' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.pricingService.setActive(user.id, id, { active: true }),
      'Price tier activated',
    );
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark price tier inactive in offer metadata' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.pricingService.setActive(user.id, id, { active: false }),
      'Price tier deactivated',
    );
  }
}
