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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import {
  CreatePaymentTermDto,
  PaymentTermQueryDto,
  UpdatePaymentTermDto,
} from './payment-terms.dto.js';
import { PaymentTermsService } from './payment-terms.service.js';

@ApiTags('Master Data - Payment Terms')
@Controller({ path: 'master-data/payment-terms', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class PaymentTermsController {
  constructor(private readonly paymentTermsService: PaymentTermsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create payment term' })
  async create(@Body() dto: CreatePaymentTermDto) {
    return successResponse(
      await this.paymentTermsService.create(dto),
      'Payment term created',
    );
  }

  @Get()
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'List payment terms' })
  async findAll(@Query() query: PaymentTermQueryDto) {
    const { items, meta } = await this.paymentTermsService.findAll(query);
    return successResponse(items, 'Payment terms retrieved', meta);
  }

  @Get('active')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'List active payment terms' })
  async findActive() {
    return successResponse(
      await this.paymentTermsService.findActive(),
      'Payment terms retrieved',
    );
  }

  @Get(':id')
  @Roles(
    RoleCode.ADMIN,
    RoleCode.SUPER_ADMIN,
    RoleCode.CUSTOMER,
    RoleCode.SELLER,
  )
  @ApiOperation({ summary: 'Get payment term' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.paymentTermsService.findOne(id),
      'Payment term retrieved',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update payment term' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentTermDto,
  ) {
    return successResponse(
      await this.paymentTermsService.update(id, dto),
      'Payment term updated',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete payment term' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.paymentTermsService.softDelete(id),
      'Payment term deleted',
    );
  }
}
