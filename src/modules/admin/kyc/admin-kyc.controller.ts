import {
  BadRequestException,
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
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../common/admin-roles.js';
import {
  ADMIN_KYC_ENTITY_TYPES,
  AdminKycApproveDto,
  AdminKycQueryDto,
  AdminKycRejectDto,
  AdminKycRequestChangesDto,
  type AdminKycEntityType,
} from './admin-kyc.dto.js';
import { AdminKycService } from './admin-kyc.service.js';

function entityTypeParam(value: string): AdminKycEntityType {
  const normalized = value.toUpperCase();
  if (!ADMIN_KYC_ENTITY_TYPES.includes(normalized as AdminKycEntityType)) {
    throw new BadRequestException('entityType must be SELLER or CUSTOMER');
  }
  return normalized as AdminKycEntityType;
}

@ApiTags('Admin KYC')
@Controller({ path: 'admin/kyc', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminKycController {
  constructor(private readonly kyc: AdminKycService) {}

  @Get()
  @ApiOperation({ summary: 'Seller onboarding and customer KYC review queue' })
  async list(@Query() query: AdminKycQueryDto) {
    const { items, meta } = await this.kyc.list(query);
    return successResponse(items, 'KYC queue retrieved', meta);
  }

  @Get(':entityType/:id')
  @ApiOperation({ summary: 'KYC record with document slots and blockers' })
  async detail(
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.kyc.detail(entityTypeParam(entityType), id),
      'KYC record retrieved',
    );
  }

  @Post(':entityType/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve KYC and verify pending documents' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminKycApproveDto,
  ) {
    return successResponse(
      await this.kyc.approve(entityTypeParam(entityType), id, user.id, dto),
      'KYC approved',
    );
  }

  @Post(':entityType/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject KYC with a reason' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminKycRejectDto,
  ) {
    return successResponse(
      await this.kyc.reject(entityTypeParam(entityType), id, user.id, dto),
      'KYC rejected',
    );
  }

  @Post(':entityType/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send KYC back to the seller/customer; selected documents must be re-uploaded',
  })
  async requestChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminKycRequestChangesDto,
  ) {
    return successResponse(
      await this.kyc.requestChanges(
        entityTypeParam(entityType),
        id,
        user.id,
        dto,
      ),
      'Changes requested',
    );
  }
}
