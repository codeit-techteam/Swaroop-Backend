import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CompanyQueryDto, UpdateCompanyDto } from './company.dto.js';
import { CompanyService } from './company.service.js';

@ApiTags('Seller Company')
@Controller({ path: 'seller/company', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @Roles(RoleCode.SELLER, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get seller company details' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyQueryDto,
  ) {
    return successResponse(
      await this.companyService.getCompany(user, query.sellerProfileId),
      'Seller company retrieved',
    );
  }

  @Patch()
  @Roles(RoleCode.SELLER)
  @ApiOperation({ summary: 'Update seller company, bank, and address' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCompanyDto,
  ) {
    return successResponse(
      await this.companyService.updateCompany(user, dto),
      'Seller company updated',
    );
  }
}
