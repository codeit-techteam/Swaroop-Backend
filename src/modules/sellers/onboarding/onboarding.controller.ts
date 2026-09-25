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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CreateOnboardingDocumentDto } from './onboarding-documents.dto.js';
import { OnboardingDocumentsService } from './onboarding-documents.service.js';
import { CreateOnboardingDto, UpdateOnboardingDto } from './onboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';

@ApiTags('Seller Onboarding')
@Controller({ path: 'seller/onboarding', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly onboardingDocuments: OnboardingDocumentsService,
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

  @Get('status')
  @ApiOperation({ summary: 'Get onboarding status' })
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
  @ApiOperation({ summary: 'Signed download URL for a stored onboarding document' })
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
  @ApiOperation({ summary: 'Remove an onboarding document from R2 and the database' })
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
