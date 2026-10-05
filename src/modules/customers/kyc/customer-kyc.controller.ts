import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import {
  UserRateLimit,
  UserRateLimitGuard,
} from '../../../common/guards/user-rate-limit.guard.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreateCustomerKycDocumentDto,
  SubmitCustomerKycDto,
  VerifyCustomerGstDto,
  VerifyCustomerPanDto,
} from './customer-kyc.dto.js';
import { CustomerKycService } from './customer-kyc.service.js';
import { CustomerKycVerificationService } from './verification/customer-kyc-verification.service.js';
import { kycRequestMeta } from '../../kyc-verification/kyc-request-meta.js';

const HOUR_MS = 60 * 60 * 1000;

@ApiTags('Customer KYC')
@Controller({ path: 'customer/kyc', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerKycController {
  constructor(
    private readonly kyc: CustomerKycService,
    private readonly verification: CustomerKycVerificationService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'KYC status, PAN/GST verification, checklist, admin change requests and document slots',
  })
  async overview(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(await this.kyc.overview(user.id), 'KYC status');
  }

  @Post('pan/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({
    bucket: 'kyc-verify-pan',
    limitConfigKey: 'kyc.verifyAttemptsPerHour',
    defaultLimit: 10,
    windowMs: HOUR_MS,
    message: 'Too many PAN verification attempts. Please try again later.',
  })
  @ApiOperation({
    summary: 'Verify the business PAN with the configured provider (Surepass)',
    description:
      'Customer role only. The PAN is validated, verified server-side, stored as a hash plus masked value, and audited. Returns the normalized result; `mismatch` is true when the verified GSTIN belongs to another PAN. Errors: 400 invalid format or KYC locked, 409 verification already in progress, 429 rate limited.',
  })
  async verifyPan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyCustomerPanDto,
    @Req() request: Request,
  ) {
    return successResponse(
      await this.verification.verifyPan(
        user.id,
        dto.pan,
        { fullName: dto.fullName, dob: dto.dob },
        kycRequestMeta(request, dto.source),
      ),
      'PAN verification result',
    );
  }

  @Post('gst/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({
    bucket: 'kyc-verify-gst',
    limitConfigKey: 'kyc.verifyAttemptsPerHour',
    defaultLimit: 10,
    windowMs: HOUR_MS,
    message: 'Too many GST verification attempts. Please try again later.',
  })
  @ApiOperation({
    summary:
      'Verify the business GSTIN with the configured provider (Surepass)',
    description:
      'Customer role only. Returns legal/trade name, GST status, state and other fields the provider reports. `mismatch` is true when the GSTIN is not registered to the verified PAN; submission is blocked until resolved. Errors: 400 invalid format or KYC locked, 409 verification already in progress, 429 rate limited.',
  })
  async verifyGst(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyCustomerGstDto,
    @Req() request: Request,
  ) {
    return successResponse(
      await this.verification.verifyGst(
        user.id,
        dto.gstin,
        kycRequestMeta(request, dto.source),
      ),
      'GST verification result',
    );
  }

  @Post('documents')
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit({
    bucket: 'kyc-document-upload',
    limitConfigKey: 'kyc.uploadsPerHour',
    defaultLimit: 30,
    windowMs: HOUR_MS,
    message: 'Too many document uploads. Please try again later.',
  })
  @ApiOperation({
    summary: 'Create a KYC document row and a signed upload URL',
  })
  async createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerKycDocumentDto,
  ) {
    return successResponse(
      await this.kyc.createUpload(user.id, dto),
      'KYC document upload created',
    );
  }

  @Post('documents/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the uploaded file and queue it for review',
  })
  async confirmDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.kyc.confirm(user.id, id),
      'KYC document stored',
    );
  }

  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Signed URL for a stored KYC document' })
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.kyc.download(user.id, id),
      'KYC document download',
    );
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a KYC document before submission' })
  async removeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.kyc.remove(user.id, id),
      'KYC document removed',
    );
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit (or resubmit) KYC for admin review' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitCustomerKycDto,
  ) {
    return successResponse(
      await this.kyc.submit(user.id, dto),
      'KYC submitted for review',
    );
  }
}
