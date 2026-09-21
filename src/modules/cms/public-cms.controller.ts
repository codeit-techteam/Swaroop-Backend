import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import { CmsBannerQueryDto } from './cms.dto.js';
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
}
