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
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import { CmsBannerQueryDto, TrackCmsBannerDto } from './cms.dto.js';
import { CmsService } from './cms.service.js';

@ApiTags('Customer CMS')
@Controller({ path: 'customer/cms/banners', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerCmsController {
  constructor(private readonly cms: CmsService) {}

  @Get()
  @ApiOperation({ summary: 'Active banners for customer apps' })
  async list(@Query() query: CmsBannerQueryDto) {
    const { items, meta } = await this.cms.listPublic('CUSTOMER', query);
    return successResponse(items, 'Banners retrieved', meta);
  }

  @Post(':id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a banner impression or click' })
  async track(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrackCmsBannerDto,
  ) {
    return successResponse(await this.cms.track(id, dto), 'Event recorded');
  }
}

@ApiTags('Seller CMS')
@Controller({ path: 'seller/cms/banners', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerCmsController {
  constructor(private readonly cms: CmsService) {}

  @Get()
  @ApiOperation({ summary: 'Active banners for seller apps' })
  async list(@Query() query: CmsBannerQueryDto) {
    const { items, meta } = await this.cms.listPublic('SELLER', query);
    return successResponse(items, 'Banners retrieved', meta);
  }

  @Post(':id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a banner impression or click' })
  async track(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TrackCmsBannerDto,
  ) {
    return successResponse(await this.cms.track(id, dto), 'Event recorded');
  }
}
