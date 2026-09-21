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
import { CreateBulkLogisticsQuoteDto } from './bulk-logistics-quotes.dto.js';
import { BulkLogisticsQuotesService } from './bulk-logistics-quotes.service.js';

@ApiTags('Customer Bulk Logistics Quotes')
@Controller({ path: 'customer/bulk-logistics-quotes', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class BulkLogisticsQuotesController {
  constructor(private readonly quotes: BulkLogisticsQuotesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a bulk logistics quote request' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBulkLogisticsQuoteDto,
  ) {
    return successResponse(
      await this.quotes.create(user.id, dto),
      'Bulk logistics quote submitted',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List own bulk logistics quote requests' })
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.quotes.listMine(user.id),
      'Bulk logistics quotes retrieved',
    );
  }
}
