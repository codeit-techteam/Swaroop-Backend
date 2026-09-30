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
  CreateAddressBookEntryDto,
  UpdateAddressBookEntryDto,
} from '../../organizations/index.js';
import { SellerAddressesService } from './seller-addresses.service.js';

@ApiTags('Seller Addresses')
@Controller({ path: 'seller/addresses', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerAddressesController {
  constructor(private readonly addresses: SellerAddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List seller pickup / warehouse addresses' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.addresses.list(user.id),
      'Addresses retrieved',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Save a seller address (search, GPS, or manual)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddressBookEntryDto,
  ) {
    return successResponse(
      await this.addresses.create(user.id, dto),
      'Address saved',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a seller address' })
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
  @ApiOperation({ summary: 'Update a seller address' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressBookEntryDto,
  ) {
    return successResponse(
      await this.addresses.update(user.id, id, dto),
      'Address updated',
    );
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the default seller address' })
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
  @ApiOperation({ summary: 'Remove a seller address' })
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
