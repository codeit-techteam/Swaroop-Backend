import {
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
import { ADMIN_FINANCE_ROLES } from '../common/admin-roles.js';
import {
  AdminCreditAccountActionDto,
  AdminCreditAccountsQueryDto,
  AdminCreditAdjustLimitDto,
  AdminCreditApplicationsQueryDto,
  AdminCreditApproveDto,
  AdminCreditArrangementDto,
  AdminCreditAuditQueryDto,
  AdminCreditDocumentRejectDto,
  AdminCreditDocumentVerifyDto,
  AdminCreditDocumentsQueryDto,
  AdminCreditInsuranceReviewDto,
  AdminCreditInsuranceUpdateDto,
  AdminCreditPartialApproveDto,
  AdminCreditRejectDto,
  AdminCreditRepaymentsQueryDto,
  AdminCreditRequestDocumentDto,
  AdminCreditRequestDocumentsDto,
  AdminCreditTransactionsQueryDto,
} from './admin-credit.dto.js';
import { AdminCreditService } from './admin-credit.service.js';

@ApiTags('Admin Credit')
@Controller({ path: 'admin/credit', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_FINANCE_ROLES)
export class AdminCreditController {
  constructor(private readonly credit: AdminCreditService) {}

  @Get('summary')
  @ApiOperation({ summary: 'PetroTrade credit management summary' })
  async summary() {
    return successResponse(await this.credit.summary(), 'Credit summary');
  }

  @Get('applications')
  @ApiOperation({ summary: 'List credit applications' })
  async listApplications(@Query() query: AdminCreditApplicationsQueryDto) {
    const { items, meta } = await this.credit.listApplications(query);
    return successResponse(items, 'Credit applications retrieved', meta);
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'Credit application detail' })
  async getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.credit.getApplication(id),
      'Credit application retrieved',
    );
  }

  @Post('applications/:id/start-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start reviewing a credit application' })
  async startReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.credit.startReview(id, user.id),
      'Credit review started',
    );
  }

  @Post('applications/:id/request-documents')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request additional credit documents' })
  async requestDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditRequestDocumentsDto,
  ) {
    return successResponse(
      await this.credit.requestDocuments(id, user.id, dto),
      'Credit documents requested',
    );
  }

  @Post('applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve PetroTrade credit application' })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditApproveDto,
  ) {
    return successResponse(
      await this.credit.approve(id, user.id, dto),
      'Credit application approved',
    );
  }

  @Post('applications/:id/partial-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve a lower limit than requested (creates an active credit account)',
  })
  async partialApprove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditPartialApproveDto,
  ) {
    return successResponse(
      await this.credit.partialApprove(id, user.id, dto),
      'Credit application partially approved',
    );
  }

  @Post('applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject credit application' })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditRejectDto,
  ) {
    return successResponse(
      await this.credit.reject(id, user.id, dto),
      'Credit application rejected',
    );
  }

  @Post('applications/:id/send-insurance-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send application to the credit insurance partner' })
  async sendInsuranceReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditInsuranceReviewDto,
  ) {
    return successResponse(
      await this.credit.sendInsuranceReview(id, user.id, dto),
      'Credit application sent for insurance review',
    );
  }

  @Post('applications/:id/mark-arrangement-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move application into credit arrangement' })
  async markArrangementPending(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditArrangementDto,
  ) {
    return successResponse(
      await this.credit.markArrangementPending(id, user.id, dto),
      'Credit arrangement pending',
    );
  }

  @Get('applications/:id/timeline')
  @ApiOperation({ summary: 'Full credit application timeline' })
  async applicationTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.credit.getTimeline(id),
      'Credit application timeline retrieved',
    );
  }

  @Post('applications/:id/documents/:documentId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a credit application document' })
  async verifyDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AdminCreditDocumentVerifyDto,
  ) {
    return successResponse(
      await this.credit.verifyApplicationDocument(id, documentId, user.id, dto),
      'Credit document verified',
    );
  }

  @Post('applications/:id/documents/:documentId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a credit application document' })
  async rejectDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: AdminCreditDocumentRejectDto,
  ) {
    return successResponse(
      await this.credit.rejectApplicationDocument(id, documentId, user.id, dto),
      'Credit document rejected',
    );
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List PetroTrade credit accounts' })
  async listAccounts(@Query() query: AdminCreditAccountsQueryDto) {
    const { items, meta } = await this.credit.listAccounts(query);
    return successResponse(items, 'Credit accounts retrieved', meta);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Credit account detail' })
  async getAccount(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.credit.getAccount(id),
      'Credit account retrieved',
    );
  }

  @Post('accounts/:id/adjust-limit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Increase or decrease credit limit' })
  async adjustLimit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditAdjustLimitDto,
  ) {
    return successResponse(
      await this.credit.adjustLimit(id, user.id, dto),
      'Credit limit updated',
    );
  }

  @Post('accounts/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a credit account' })
  async suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditAccountActionDto,
  ) {
    return successResponse(
      await this.credit.suspend(id, user.id, dto),
      'Credit account suspended',
    );
  }

  @Get('exposure')
  @ApiOperation({ summary: 'Platform credit exposure across accounts' })
  async exposure(@Query() query: AdminCreditAccountsQueryDto) {
    return successResponse(
      await this.credit.exposure(query),
      'Credit exposure retrieved',
    );
  }

  @Get('outstanding')
  @ApiOperation({ summary: 'Accounts with outstanding credit' })
  async outstanding(@Query() query: AdminCreditAccountsQueryDto) {
    return successResponse(
      await this.credit.outstanding(query),
      'Outstanding credit retrieved',
    );
  }

  @Post('accounts/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a credit account (alias of reactivate)' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditAccountActionDto,
  ) {
    return successResponse(
      await this.credit.reactivate(id, user.id, dto),
      'Credit account activated',
    );
  }

  @Post('accounts/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a credit account' })
  async reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditAccountActionDto,
  ) {
    return successResponse(
      await this.credit.reactivate(id, user.id, dto),
      'Credit account reactivated',
    );
  }

  @Get('utilization')
  @ApiOperation({ summary: 'Credit utilization across accounts' })
  async utilization(@Query() query: AdminCreditAccountsQueryDto) {
    const { items, meta } = await this.credit.listUtilization(query);
    return successResponse(items, 'Credit utilization retrieved', meta);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Credit ledger transactions' })
  async transactions(@Query() query: AdminCreditTransactionsQueryDto) {
    const { items, meta } = await this.credit.listTransactions(query);
    return successResponse(items, 'Credit transactions retrieved', meta);
  }

  @Get('repayments')
  @ApiOperation({
    summary: 'Credit repayments from existing payment schedules',
  })
  async repayments(@Query() query: AdminCreditRepaymentsQueryDto) {
    const { items, meta } = await this.credit.listRepayments(query);
    return successResponse(items, 'Credit repayments retrieved', meta);
  }

  @Get('insurance')
  @ApiOperation({
    summary: 'Credit insurance records (provider integration pending)',
  })
  async insurance(@Query() query: AdminCreditAccountsQueryDto) {
    const { items, meta } = await this.credit.listInsurance(query);
    return successResponse(items, 'Credit insurance retrieved', meta);
  }

  @Post('accounts/:id/insurance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update credit insurance metadata' })
  async updateInsurance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditInsuranceUpdateDto,
  ) {
    return successResponse(
      await this.credit.updateInsurance(id, user.id, dto),
      'Credit insurance updated',
    );
  }

  @Get('documents')
  @ApiOperation({ summary: 'Credit-related documents' })
  async documents(@Query() query: AdminCreditDocumentsQueryDto) {
    const { items, meta } = await this.credit.listDocuments(query);
    return successResponse(items, 'Credit documents retrieved', meta);
  }

  @Post('accounts/:id/request-document')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a credit document from the customer' })
  async requestDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCreditRequestDocumentDto,
  ) {
    return successResponse(
      await this.credit.requestDocument(id, user.id, dto),
      'Credit document requested',
    );
  }

  @Get('documents/:id/download')
  @ApiOperation({
    summary: 'Download credit document (R2 pending if unconfigured)',
  })
  async download(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.credit.downloadDocument(id),
      'Credit document download',
    );
  }

  @Get('audit')
  @ApiOperation({ summary: 'Credit audit trail' })
  async audit(@Query() query: AdminCreditAuditQueryDto) {
    const { items, meta } = await this.credit.listAudit(query);
    return successResponse(items, 'Credit audit retrieved', meta);
  }

  @Get('customers/:customerId')
  @ApiOperation({ summary: 'Customer credit snapshot' })
  async customerCredit(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return successResponse(
      await this.credit.getCustomerCredit(customerId),
      'Customer credit retrieved',
    );
  }
}
