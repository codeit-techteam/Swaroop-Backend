import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  CreatePriceAlertDto,
  ListPriceAlertsQueryDto,
  UpdatePriceAlertDto,
} from './price-alerts.dto.js';
import { PriceAlertsService } from './price-alerts.service.js';

@ApiTags('Customer Price Alerts')
@Controller({ path: 'customer/price-alerts', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class PriceAlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List my price alerts (stored; evaluation worker not yet configured)',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPriceAlertsQueryDto,
  ) {
    const { items, meta } = await this.alerts.list(user.id, query);
    return successResponse(items, 'Price alerts', meta);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceAlertDto,
  ) {
    return successResponse(
      await this.alerts.create(user.id, dto),
      'Price alert created',
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceAlertDto,
  ) {
    return successResponse(
      await this.alerts.update(user.id, id, dto),
      'Price alert updated',
    );
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.alerts.remove(user.id, id),
      'Price alert deleted',
    );
  }
}
