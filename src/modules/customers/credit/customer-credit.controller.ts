import {
  Body,
  Controller,
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
  CustomerCreditApplyDto,
  CustomerCreditDocumentReplaceDto,
  CustomerCreditDocumentUploadDto,
  CustomerCreditDraftDto,
  CustomerCreditResubmitDocumentsDto,
} from './customer-credit.dto.js';
import { CustomerCreditService } from './customer-credit.service.js';

@ApiTags('Customer Credit')
@Controller({ path: 'customer/credit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerCreditController {
  constructor(private readonly credit: CustomerCreditService) {}

  @Get('account')
  @ApiOperation({ summary: 'Own PetroTrade credit account' })
  async account(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getAccount(user.id),
      'Credit account retrieved',
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Own credit application and account status' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getStatus(user.id),
      'Credit status retrieved',
    );
  }

  @Get('limit')
  @ApiOperation({ summary: 'Own approved and available credit limits' })
  async limit(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getLimit(user.id),
      'Credit limit retrieved',
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'Own credit summary' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getSummary(user.id),
      'Credit summary retrieved',
    );
  }

  @Get('eligibility')
  @ApiOperation({
    summary:
      'PetroTrade credit eligibility for checkout (no underwriting details)',
  })
  async eligibility(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getEligibility(user.id),
      'Credit eligibility retrieved',
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Own credit ledger transactions' })
  async transactions(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.listTransactions(user.id),
      'Credit transactions retrieved',
    );
  }

  @Post('apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Apply for PetroTrade managed credit in one step (submits immediately)',
  })
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CustomerCreditApplyDto,
  ) {
    return successResponse(
      await this.credit.apply(user.id, dto),
      'Credit application submitted',
    );
  }

  @Post('applications')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create or update the open credit application draft',
  })
  async saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CustomerCreditDraftDto,
  ) {
    return successResponse(
      await this.credit.saveDraft(user.id, dto),
      'Credit application draft saved',
    );
  }

  @Get('application')
  @ApiOperation({ summary: 'Latest own credit application' })
  async latestApplication(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.credit.getLatestApplication(user.id),
      'Credit application retrieved',
    );
  }

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Own credit application detail with documents and timeline',
  })
  async getApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.getApplication(user.id, id),
      'Credit application retrieved',
    );
  }

  @Get('applications/:id/status')
  @ApiOperation({ summary: 'Own credit application status snapshot' })
  async applicationStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.getApplicationStatus(user.id, id),
      'Credit application status retrieved',
    );
  }

  @Get('applications/:id/timeline')
  @ApiOperation({ summary: 'Customer-visible credit application timeline' })
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.getTimeline(user.id, id),
      'Credit application timeline retrieved',
    );
  }

  @Get('applications/:id/documents')
  @ApiOperation({ summary: 'Documents attached to own credit application' })
  async listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.listApplicationDocuments(user.id, id),
      'Credit application documents retrieved',
    );
  }

  @Post('applications/:id/documents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Attach a document to own credit application (returns uploadUrl)',
  })
  async createDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerCreditDocumentUploadDto,
  ) {
    return successResponse(
      await this.credit.createApplicationDocument(user.id, id, dto),
      'Credit application document created',
    );
  }

  @Post('applications/:id/documents/:documentId/replace')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace a rejected or outdated credit document' })
  async replaceDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CustomerCreditDocumentReplaceDto,
  ) {
    return successResponse(
      await this.credit.replaceApplicationDocument(
        user.id,
        id,
        documentId,
        dto,
      ),
      'Credit application document replaced',
    );
  }

  @Get('applications/:id/documents/:documentId/download')
  @ApiOperation({ summary: 'Signed download URL for own credit document' })
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.credit.downloadApplicationDocument(user.id, id, documentId),
      'Credit application document download',
    );
  }

  @Get('applications/:id/documents/:documentId/upload-url')
  @ApiOperation({ summary: 'Signed upload URL for own credit document' })
  async documentUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.credit.applicationDocumentUploadUrl(user.id, id, documentId),
      'Credit application document upload URL',
    );
  }

  @Post('applications/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit the draft credit application for review',
  })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.submit(user.id, id),
      'Credit application submitted',
    );
  }

  @Post('applications/:id/resubmit-documents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send re-uploaded documents back for verification',
  })
  async resubmitDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerCreditResubmitDocumentsDto,
  ) {
    return successResponse(
      await this.credit.resubmitDocuments(user.id, id, dto),
      'Credit documents resubmitted',
    );
  }
}
