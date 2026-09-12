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
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { LogisticsListQueryDto, UploadPodDto } from '../dto/logistics.dto.js';
import { LogisticsActorService } from '../services/logistics-actor.service.js';
import { ShipmentService } from '../services/shipment.service.js';
import { DeliveryService } from '../services/delivery.service.js';
import { LogisticsSummaryService } from '../services/logistics-summary.service.js';

@ApiTags('Customer Logistics')
@Controller({ path: 'customer', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.CUSTOMER)
export class CustomerLogisticsController {
  constructor(
    private readonly actors: LogisticsActorService,
    private readonly shipments: ShipmentService,
    private readonly deliveries: DeliveryService,
    private readonly summary: LogisticsSummaryService,
  ) {}

  @Get('shipment-summary')
  @ApiOperation({ summary: 'Customer shipment summary' })
  async shipmentSummary(@CurrentUser() user: AuthenticatedUser) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.summary.forCustomer(customer.organizationId),
      'Shipment summary',
    );
  }

  @Get('shipments')
  @ApiOperation({ summary: 'List customer shipments' })
  async listShipments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.shipments.list({
      customerOrgId: customer.organizationId,
      skip,
      take,
      status: query.shipmentStatus,
    });
    return successResponse(
      items.map((s) => this.shipments.toCustomerView(s)),
      'Shipments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('shipments/:id')
  @ApiOperation({ summary: 'Get customer shipment' })
  async getShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const shipment = await this.shipments.get(id, {
      customerOrgId: customer.organizationId,
    });
    return successResponse(
      this.shipments.toCustomerView(shipment),
      'Shipment retrieved',
    );
  }

  @Get('shipments/:id/status')
  @ApiOperation({ summary: 'Get shipment status' })
  async shipmentStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const shipment = await this.shipments.get(id, {
      customerOrgId: customer.organizationId,
    });
    return successResponse(
      {
        id: shipment.id,
        referenceNumber: shipment.referenceNumber,
        status: shipment.status,
        eta: shipment.eta,
        dispatchedAt: shipment.dispatchedAt,
        deliveredAt: shipment.deliveredAt,
      },
      'Shipment status',
    );
  }

  @Get('shipments/:id/tracking')
  @ApiOperation({ summary: 'Get shipment tracking timeline' })
  async shipmentTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const shipment = await this.shipments.get(id, {
      customerOrgId: customer.organizationId,
    });
    const view = this.shipments.toCustomerView(shipment);
    return successResponse(view.trackingEvents, 'Tracking retrieved');
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'List customer deliveries' })
  async listDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.deliveries.list({
      customerOrgId: customer.organizationId,
      skip,
      take,
      status: query.deliveryStatus,
    });
    return successResponse(
      items.map((d) => this.deliveries.toCustomerView(d)),
      'Deliveries retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Get customer delivery' })
  async getDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const delivery = await this.deliveries.get(id, {
      customerOrgId: customer.organizationId,
    });
    return successResponse(
      this.deliveries.toCustomerView(delivery),
      'Delivery retrieved',
    );
  }

  @Post('deliveries/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm delivery receipt' })
  async confirmDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const delivery = await this.deliveries.confirm(id, {
      customerOrgId: customer.organizationId,
      userId: user.id,
      role: 'CUSTOMER',
    });
    return successResponse(
      this.deliveries.toCustomerView(delivery),
      'Delivery confirmed',
    );
  }

  @Post('deliveries/:id/upload-pod')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload POD metadata (R2 key)' })
  async uploadPod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadPodDto,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    const delivery = await this.deliveries.uploadPod(id, body, {
      customerOrgId: customer.organizationId,
      userId: user.id,
      role: 'CUSTOMER',
    });
    return successResponse(
      this.deliveries.toCustomerView(delivery),
      'POD metadata saved',
    );
  }

  @Get('deliveries/:id/pod-url')
  @ApiOperation({ summary: 'Get signed POD URL if storage configured' })
  async podUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const customer = await this.actors.requireCustomerOrg(user.id);
    return successResponse(
      await this.deliveries.getPodSignedUrl(id, {
        customerOrgId: customer.organizationId,
      }),
      'POD URL',
    );
  }
}
