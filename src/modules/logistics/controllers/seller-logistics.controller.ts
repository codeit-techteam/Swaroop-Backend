import {
  Body,
  Controller,
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
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  AssignVehicleDto,
  CreateDispatchDto,
  CreateDriverDto,
  CreateVehicleDto,
  CreateVehicleSlotDto,
  LogisticsListQueryDto,
  MarkDeliveredDto,
  TrackingEventDto,
  UpdateDriverDto,
  UpdateEtaDto,
  UpdateVehicleDto,
  UploadPodDto,
  UpsertEwayBillDto,
} from '../dto/logistics.dto.js';
import { LogisticsActorService } from '../services/logistics-actor.service.js';
import { DispatchService } from '../services/dispatch.service.js';
import { ShipmentService } from '../services/shipment.service.js';
import { DeliveryService } from '../services/delivery.service.js';
import { VehicleService } from '../services/vehicle.service.js';
import { DriverService } from '../services/driver.service.js';
import { VehicleSlotService } from '../services/vehicle-slot.service.js';
import { EwayBillService } from '../services/eway-bill.service.js';
import { LogisticsSummaryService } from '../services/logistics-summary.service.js';

@ApiTags('Seller Logistics')
@Controller({ path: 'seller', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerLogisticsController {
  constructor(
    private readonly actors: LogisticsActorService,
    private readonly dispatches: DispatchService,
    private readonly shipments: ShipmentService,
    private readonly deliveries: DeliveryService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly slots: VehicleSlotService,
    private readonly eway: EwayBillService,
    private readonly summary: LogisticsSummaryService,
  ) {}

  @Get('logistics/summary')
  @ApiOperation({ summary: 'Seller logistics summary' })
  async logisticsSummary(@CurrentUser() user: AuthenticatedUser) {
    const seller = await this.actors.requireSellerOrg(user.id);
    return successResponse(
      await this.summary.forSeller(seller.organizationId),
      'Logistics summary',
    );
  }

  // --- Dispatches ---

  @Get('dispatches')
  @ApiOperation({ summary: 'List seller dispatches' })
  async listDispatches(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.dispatches.list({
      sellerOrgId: seller.organizationId,
      skip,
      take,
      status: query.dispatchStatus,
    });
    return successResponse(
      items.map((d) => this.dispatches.toSellerView(d)),
      'Dispatches retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('dispatches')
  @ApiOperation({ summary: 'Create dispatch for a purchase order' })
  async createDispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDispatchDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.create(seller.organizationId, body, {
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Dispatch created',
    );
  }

  @Get('dispatches/:id')
  @ApiOperation({ summary: 'Get seller dispatch' })
  async getDispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.get(id, {
      sellerOrgId: seller.organizationId,
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Dispatch retrieved',
    );
  }

  @Post('dispatches/:id/assign-vehicle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign vehicle to dispatch' })
  async assignVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignVehicleDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.assignVehicle(id, body, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Vehicle assigned',
    );
  }

  @Post('dispatches/:id/eway-bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or update e-way bill' })
  async upsertEway(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertEwayBillDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const eway = await this.eway.upsert(id, body, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(this.eway.toSellerView(eway), 'E-way bill saved');
  }

  @Get('dispatches/:id/eway-bill')
  @ApiOperation({ summary: 'Get e-way bills for dispatch' })
  async getEway(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const bills = await this.eway.getForDispatch(id, seller.organizationId);
    return successResponse(
      bills.map((b) => this.eway.toSellerView(b)),
      'E-way bills retrieved',
    );
  }

  @Post('dispatches/:id/start-loading')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start loading' })
  async startLoading(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.startLoading(id, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Loading started',
    );
  }

  @Post('dispatches/:id/complete-loading')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete loading' })
  async completeLoading(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.completeLoading(id, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Loading completed',
    );
  }

  @Post('dispatches/:id/mark-ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark dispatch ready for dispatch' })
  async markReady(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const dispatch = await this.dispatches.markReady(id, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.dispatches.toSellerView(dispatch),
      'Dispatch ready',
    );
  }

  @Post('dispatches/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute dispatch → create shipment' })
  async executeDispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const result = await this.dispatches.executeDispatch(id, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      {
        dispatch: this.dispatches.toSellerView(result.dispatch),
        shipment: this.shipments.toSellerView(result.shipment as never),
        delivery: this.deliveries.toSellerView(result.delivery as never),
      },
      'Dispatch executed',
    );
  }

  // --- Shipments ---

  @Get('shipments')
  @ApiOperation({ summary: 'List seller shipments' })
  async listShipments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.shipments.list({
      sellerOrgId: seller.organizationId,
      skip,
      take,
      status: query.shipmentStatus,
    });
    return successResponse(
      items.map((s) => this.shipments.toSellerView(s)),
      'Shipments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('shipments/:id')
  @ApiOperation({ summary: 'Get seller shipment' })
  async getShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const shipment = await this.shipments.get(id, {
      sellerOrgId: seller.organizationId,
    });
    return successResponse(
      this.shipments.toSellerView(shipment),
      'Shipment retrieved',
    );
  }

  @Get('shipments/:id/tracking')
  @ApiOperation({ summary: 'Get seller shipment tracking' })
  async getTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const shipment = await this.shipments.get(id, {
      sellerOrgId: seller.organizationId,
    });
    return successResponse(
      this.shipments.toSellerView(shipment).trackingEvents,
      'Tracking retrieved',
    );
  }

  @Post('shipments/:id/tracking-events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add tracking event' })
  async addTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TrackingEventDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const result = await this.shipments.addTrackingEvent(id, body, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.shipments.toSellerView(result.shipment),
      'Tracking event added',
    );
  }

  @Post('shipments/:id/eta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update shipment ETA' })
  async updateEta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEtaDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const shipment = await this.shipments.updateEta(id, body.eta, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.shipments.toSellerView(shipment),
      'ETA updated',
    );
  }

  // --- Deliveries ---

  @Get('deliveries')
  @ApiOperation({ summary: 'List seller deliveries' })
  async listDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.deliveries.list({
      sellerOrgId: seller.organizationId,
      skip,
      take,
      status: query.deliveryStatus,
    });
    return successResponse(
      items.map((d) => this.deliveries.toSellerView(d)),
      'Deliveries retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Get seller delivery' })
  async getDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const delivery = await this.deliveries.get(id, {
      sellerOrgId: seller.organizationId,
    });
    return successResponse(
      this.deliveries.toSellerView(delivery),
      'Delivery retrieved',
    );
  }

  @Post('deliveries/:id/mark-delivered')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark delivery as delivered' })
  async markDelivered(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarkDeliveredDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const delivery = await this.deliveries.markDelivered(id, body, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.deliveries.toSellerView(delivery),
      'Delivery marked delivered',
    );
  }

  @Post('deliveries/:id/upload-pod')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload POD metadata' })
  async uploadPod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadPodDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const delivery = await this.deliveries.uploadPod(id, body, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(
      this.deliveries.toSellerView(delivery),
      'POD metadata saved',
    );
  }

  // --- Vehicles ---

  @Get('vehicles')
  @ApiOperation({ summary: 'List seller vehicles' })
  async listVehicles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.vehicles.list({
      organizationId: seller.organizationId,
      skip,
      take,
    });
    return successResponse(
      items.map((v) => this.vehicles.toSellerView(v)),
      'Vehicles retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Create seller vehicle' })
  async createVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateVehicleDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const vehicle = await this.vehicles.create(seller.organizationId, body);
    return successResponse(
      this.vehicles.toSellerView(vehicle),
      'Vehicle created',
    );
  }

  @Get('vehicles/:id')
  @ApiOperation({ summary: 'Get seller vehicle' })
  async getVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const vehicle = await this.vehicles.get(id, seller.organizationId);
    return successResponse(
      this.vehicles.toSellerView(vehicle),
      'Vehicle retrieved',
    );
  }

  @Patch('vehicles/:id')
  @ApiOperation({ summary: 'Update seller vehicle' })
  async updateVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVehicleDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const vehicle = await this.vehicles.update(id, body, {
      organizationId: seller.organizationId,
    });
    return successResponse(
      this.vehicles.toSellerView(vehicle),
      'Vehicle updated',
    );
  }

  // --- Drivers ---

  @Get('drivers')
  @ApiOperation({ summary: 'List seller drivers' })
  async listDrivers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.drivers.list({
      organizationId: seller.organizationId,
      skip,
      take,
    });
    return successResponse(
      items.map((d) => this.drivers.toView(d)),
      'Drivers retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('drivers')
  @ApiOperation({ summary: 'Create seller driver' })
  async createDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDriverDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const driver = await this.drivers.create(seller.organizationId, body);
    return successResponse(this.drivers.toView(driver), 'Driver created');
  }

  @Get('drivers/:id')
  @ApiOperation({ summary: 'Get seller driver' })
  async getDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const driver = await this.drivers.get(id, seller.organizationId);
    return successResponse(this.drivers.toView(driver), 'Driver retrieved');
  }

  @Patch('drivers/:id')
  @ApiOperation({ summary: 'Update seller driver' })
  async updateDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDriverDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const driver = await this.drivers.update(id, body, {
      organizationId: seller.organizationId,
    });
    return successResponse(this.drivers.toView(driver), 'Driver updated');
  }

  // --- Vehicle slots ---

  @Get('vehicle-slots')
  @ApiOperation({ summary: 'List seller vehicle slots' })
  async listSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LogisticsListQueryDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.slots.list({
      sellerOrgId: seller.organizationId,
      skip,
      take,
      status: query.slotStatus,
    });
    return successResponse(
      items.map((s) => this.slots.toView(s)),
      'Vehicle slots retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('vehicle-slots')
  @ApiOperation({ summary: 'Request vehicle slot' })
  async createSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateVehicleSlotDto,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    if (body.dispatchId) {
      await this.dispatches.get(body.dispatchId, {
        sellerOrgId: seller.organizationId,
      });
    }
    const slot = await this.slots.create(body, {
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(this.slots.toView(slot), 'Vehicle slot requested');
  }

  @Get('vehicle-slots/:id')
  @ApiOperation({ summary: 'Get seller vehicle slot' })
  async getSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const slot = await this.slots.get(id, seller.organizationId);
    return successResponse(this.slots.toView(slot), 'Vehicle slot retrieved');
  }

  @Post('vehicle-slots/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel vehicle slot' })
  async cancelSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const seller = await this.actors.requireSellerOrg(user.id);
    const slot = await this.slots.cancel(id, {
      sellerOrgId: seller.organizationId,
      userId: user.id,
      role: 'SELLER',
    });
    return successResponse(this.slots.toView(slot), 'Vehicle slot cancelled');
  }
}
