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
import { CustomerOfferQueryDto } from './offers.dto.js';
import { OffersService } from './offers.service.js';

@ApiTags('Customer Offers')
@Controller({ path: 'customer/offers', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'List marketplace offers' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CustomerOfferQueryDto,
  ) {
    const { items, meta } = await this.offersService.findAll(user.id, query);
    return successResponse(items, 'Offers retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get offer detail' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.offersService.findOne(user.id, id),
      'Offer retrieved',
    );
  }
}
