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
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreateCheckoutQuoteDto,
} from './checkout.dto.js';
import { CheckoutService } from './checkout.service.js';

@ApiTags('Customer Checkout')
@Controller({ path: 'customer/checkout', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get('addresses')
  @ApiOperation({ summary: 'List customer organization shipping/billing addresses' })
  async addresses(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.checkout.listAddresses(user.id),
      'Addresses retrieved',
    );
  }

  @Get('payment-options')
  @ApiOperation({
    summary: 'Platform payment options with PetroTrade credit eligibility',
  })
  async paymentOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('amount') amount?: string,
  ) {
    const parsed = amount != null && amount !== '' ? Number(amount) : undefined;
    return successResponse(
      await this.checkout.paymentOptions(
        user.id,
        Number.isFinite(parsed) ? parsed : undefined,
      ),
      'Payment options retrieved',
    );
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create a server-authoritative checkout quote (seller matching + pricing)',
  })
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCheckoutQuoteDto,
  ) {
    return successResponse(
      await this.checkout.quote(user.id, dto),
      'Quote generated',
    );
  }

  @Get('quotes/:id')
  @ApiOperation({ summary: 'Load a previously generated checkout quote' })
  async getQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.checkout.getQuote(user.id, id),
      'Quote retrieved',
    );
  }
}
