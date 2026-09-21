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
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './addresses.dto.js';
import { CustomerAddressesService } from './addresses.service.js';

@ApiTags('Customer Addresses')
@Controller({ path: 'customer/addresses', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerAddressesController {
  constructor(private readonly addresses: CustomerAddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List saved delivery addresses' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.addresses.list(user.id),
      'Addresses retrieved',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Save a delivery address (GPS, pincode, or manual)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    return successResponse(
      await this.addresses.create(user.id, dto),
      'Address saved',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a saved delivery address' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.addresses.get(user.id, id),
      'Address retrieved',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a saved delivery address' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return successResponse(
      await this.addresses.update(user.id, id, dto),
      'Address updated',
    );
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the default delivery address' })
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.addresses.setDefault(user.id, id),
      'Default address updated',
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a saved delivery address' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.addresses.remove(user.id, id),
      'Address removed',
    );
  }
}
