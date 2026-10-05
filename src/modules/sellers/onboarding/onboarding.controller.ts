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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import {
  UserRateLimit,
  UserRateLimitGuard,
} from '../../../common/guards/user-rate-limit.guard.js';
import { kycRequestMeta } from '../../kyc-verification/kyc-request-meta.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CreateOnboardingDocumentDto } from './onboarding-documents.dto.js';
import { OnboardingDocumentsService } from './onboarding-documents.service.js';
import {
  CreateOnboardingDto,
  UpdateOnboardingDto,
  VerifySellerGstDto,
  VerifySellerPanDto,
} from './onboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';
import { SellerKycVerificationService } from './seller-kyc-verification.service.js';

const HOUR_MS = 60 * 60 * 1000;

@ApiTags('Seller Onboarding')
@Controller({ path: 'seller/onboarding', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly onboardingDocuments: OnboardingDocumentsService,
    private readonly kycVerification: SellerKycVerificationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Start or upsert seller onboarding' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnboardingDto,
  ) {
    const data = await this.onboardingService.create(user.id, dto, user);
    return successResponse(data, 'Onboarding started');
  }

  @Get()
  @ApiOperation({ summary: 'Get seller onboarding payload' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.get(user.id),
      'Onboarding retrieved',
    );
  }

  @Patch()
  @ApiOperation({ summary: 'Update onboarding draft' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return successResponse(
      await this.onboardingService.update(user.id, dto),
      'Onboarding updated',
    );
  }

  @Post('submit')
  @ApiOperation({ summary: 'Submit onboarding for admin review' })
  async submit(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.submit(user.id),
      'Onboarding submitted',
    );
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
    summary: 'Verify the seller PAN with the configured provider (Surepass)',
    description:
      'Seller account owner only (not Seller Managers). The accepted PAN is written into the onboarding draft by the server. Returns the normalized result; `mismatch` is true when the verified GSTIN belongs to another PAN. Errors: 400 invalid format or onboarding locked, 403 manager, 409 verification already in progress, 429 rate limited.',
  })
  async verifyPan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifySellerPanDto,
    @Req() request: Request,
  ) {
    return successResponse(
      await this.kycVerification.verifyPan(
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
    summary: 'Verify the seller GSTIN with the configured provider (Surepass)',
    description:
      'Seller account owner only. Returns legal/trade name, GST status, state and other fields the provider reports; the accepted GSTIN is written into the onboarding draft. Submission is blocked while `mismatch` is true. Errors: 400, 403, 409, 429 as for PAN.',
  })
  async verifyGst(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifySellerGstDto,
    @Req() request: Request,
  ) {
    return successResponse(
      await this.kycVerification.verifyGst(
        user.id,
        dto.gstin,
        kycRequestMeta(request, dto.source),
      ),
      'GST verification result',
    );
  }

  @Get('status')
  @ApiOperation({
    summary:
      'Onboarding status, admin change requests, PAN/GST verification results and remaining verification blockers',
  })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.status(user.id),
      'Onboarding status',
    );
  }

  @Get('documents')
  @ApiOperation({
    summary: 'List required onboarding documents and their R2-backed records',
  })
  async listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingDocuments.list(user.id),
      'Onboarding documents',
    );
  }

  @Post('documents')
  @ApiOperation({
    summary: 'Create an onboarding document row and a signed R2 upload URL',
  })
  async createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnboardingDocumentDto,
  ) {
    return successResponse(
      await this.onboardingDocuments.createUpload(user.id, dto),
      'Onboarding document upload created',
    );
  }

  @Post('documents/:id/confirm')
  @ApiOperation({
    summary: 'Confirm the file exists in R2 and mark it ready for review',
  })
  async confirmDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.onboardingDocuments.confirm(user.id, id),
      'Onboarding document stored',
    );
  }

  @Get('documents/:id/download')
  @ApiOperation({
    summary: 'Signed download URL for a stored onboarding document',
  })
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.onboardingDocuments.download(user.id, id),
      'Onboarding document download',
    );
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove an onboarding document from R2 and the database',
  })
  async removeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.onboardingDocuments.remove(user.id, id),
      'Onboarding document removed',
    );
  }
}
