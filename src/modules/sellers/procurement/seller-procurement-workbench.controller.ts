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
import { SellerProcurementWorkbenchQueryDto } from './seller-procurement-workbench.dto.js';
import { SellerProcurementWorkbenchService } from './seller-procurement-workbench.service.js';

@ApiTags('Seller Procurement Workbench')
@Controller({ path: 'seller/procurement/workbench', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerProcurementWorkbenchController {
  constructor(private readonly workbench: SellerProcurementWorkbenchService) {}

  @Get()
  @ApiOperation({
    summary:
      'Blind Procurement Workbench list (no customer identity; no buyer filter)',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerProcurementWorkbenchQueryDto,
  ) {
    const { items, meta } = await this.workbench.list(user.id, query);
    return successResponse(items, 'Procurement workbench retrieved', meta);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Blind Procurement Workbench KPIs, pipeline, and action cards',
  })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.workbench.summary(user.id),
      'Procurement workbench summary',
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Blind Procurement Workbench detail (seller-owned only)',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.workbench.findOne(user.id, id),
      'Procurement record retrieved',
    );
  }
}
