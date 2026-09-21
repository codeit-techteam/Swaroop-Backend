import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CustomerCreditApplyDto } from './customer-credit.dto.js';
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
    summary: 'PetroTrade credit eligibility for checkout (no underwriting details)',
  })
  async eligibility(
    @CurrentUser() user: AuthenticatedUser,
  ) {
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
  @ApiOperation({ summary: 'Apply for PetroTrade managed credit' })
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
    summary: 'Apply for PetroTrade managed credit (alias of POST apply)',
  })
  async applyAlias(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CustomerCreditApplyDto,
  ) {
    return successResponse(
      await this.credit.apply(user.id, dto),
      'Credit application submitted',
    );
  }
}
