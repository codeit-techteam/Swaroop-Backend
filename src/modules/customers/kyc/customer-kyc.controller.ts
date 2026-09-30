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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreateCustomerKycDocumentDto,
  SubmitCustomerKycDto,
} from './customer-kyc.dto.js';
import { CustomerKycService } from './customer-kyc.service.js';

@ApiTags('Customer KYC')
@Controller({ path: 'customer/kyc', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerKycController {
  constructor(private readonly kyc: CustomerKycService) {}

  @Get()
  @ApiOperation({
    summary: 'KYC status, admin change requests and required document slots',
  })
  async overview(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(await this.kyc.overview(user.id), 'KYC status');
  }

  @Post('documents')
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
