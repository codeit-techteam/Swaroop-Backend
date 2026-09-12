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
import { CreateOfferDto, OfferQueryDto, UpdateOfferDto } from './offers.dto.js';
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update offer' })
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
      'Activate offer (DRAFT→PENDING_REVIEW→ACTIVE for approved sellers)',
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
  @ApiOperation({ summary: 'Soft delete offer' })
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
