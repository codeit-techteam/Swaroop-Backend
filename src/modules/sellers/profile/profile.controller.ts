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
import {
  SellerProfileQueryDto,
  UpdateSellerProfileDto,
} from './profile.dto.js';
import { ProfileService } from './profile.service.js';

@ApiTags('Seller Profile')
@Controller({ path: 'seller', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('profile')
  @Roles(RoleCode.SELLER, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get seller profile' })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerProfileQueryDto,
  ) {
    return successResponse(
      await this.profileService.getProfile(user, query.sellerProfileId),
      'Seller profile retrieved',
    );
  }

  @Patch('profile')
  @Roles(RoleCode.SELLER)
  @ApiOperation({ summary: 'Update seller profile' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    return successResponse(
      await this.profileService.updateProfile(user, dto),
      'Seller profile updated',
    );
  }

  @Get('status')
  @Roles(RoleCode.SELLER, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get seller verification and onboarding status' })
  async getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SellerProfileQueryDto,
  ) {
    return successResponse(
      await this.profileService.getStatus(user, query.sellerProfileId),
      'Seller status retrieved',
    );
  }
}
