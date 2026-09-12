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
import { PrismaService } from '../../../database/prisma.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import {
  AssignVehicleDto,
  CreateDispatchDto,
  CreateDriverDto,
  CreateVehicleDto,
  CreateVehicleSlotDto,
  DeliveryExceptionDto,
  LogisticsListQueryDto,
  MarkDeliveredDto,
  TrackingEventDto,
  UpdateDriverDto,
  UpdateEtaDto,
  UpdateVehicleDto,
  UploadPodDto,
  UpsertEwayBillDto,
} from '../dto/logistics.dto.js';
import { DispatchService } from '../services/dispatch.service.js';
import { ShipmentService } from '../services/shipment.service.js';
import { DeliveryService } from '../services/delivery.service.js';
import { VehicleService } from '../services/vehicle.service.js';
import { DriverService } from '../services/driver.service.js';
import { VehicleSlotService } from '../services/vehicle-slot.service.js';
import { EwayBillService } from '../services/eway-bill.service.js';
import { LogisticsSummaryService } from '../services/logistics-summary.service.js';

const ADMIN_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.OPERATIONS_MANAGER,
] as const;

@ApiTags('Admin Logistics')
@Controller({ path: 'admin/logistics', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_ROLES)
export class AdminLogisticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatches: DispatchService,
    private readonly shipments: ShipmentService,
    private readonly deliveries: DeliveryService,
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly slots: VehicleSlotService,
    private readonly eway: EwayBillService,
    private readonly summary: LogisticsSummaryService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Admin logistics summary' })
  async logisticsSummary() {
    return successResponse(await this.summary.forAdmin(), 'Logistics summary');
  }

  @Get('dispatches')
  @ApiOperation({ summary: 'List all dispatches' })
  async listDispatches(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.dispatches.list({
      skip,
      take,
      status: query.dispatchStatus,
    });
    return successResponse(
      items.map((d) => this.dispatches.toAdminView(d)),
      'Dispatches retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('dispatches')
  @ApiOperation({ summary: 'Create dispatch (admin; body includes PO)' })
  async createDispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateDispatchDto,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: body.purchaseOrderId, deletedAt: null },
      select: { sellerOrgId: true },
    });
    if (!po) {
      throw new LogisticsException('PO_NOT_FOUND');
    }
    const dispatch = await this.dispatches.create(po.sellerOrgId, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.dispatches.toAdminView(dispatch),
      'Dispatch created',
    );
  }

  @Get('dispatches/:id')
  @ApiOperation({ summary: 'Get dispatch' })
  async getDispatch(@Param('id', ParseUUIDPipe) id: string) {
    const dispatch = await this.dispatches.get(id);
    return successResponse(
      this.dispatches.toAdminView(dispatch),
      'Dispatch retrieved',
    );
  }

  @Post('dispatches/:id/assign-vehicle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign vehicle' })
  async assignVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignVehicleDto,
  ) {
    const dispatch = await this.dispatches.assignVehicle(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.dispatches.toAdminView(dispatch),
      'Vehicle assigned',
    );
  }

  @Post('dispatches/:id/eway-bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add e-way bill' })
  async upsertEway(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpsertEwayBillDto,
  ) {
    const eway = await this.eway.upsert(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.eway.toAdminView(eway), 'E-way bill saved');
  }

  @Get('dispatches/:id/eway-bill')
  @ApiOperation({ summary: 'Get e-way bills' })
  async getEway(@Param('id', ParseUUIDPipe) id: string) {
    const bills = await this.eway.getForDispatch(id);
    return successResponse(
      bills.map((b) => this.eway.toAdminView(b)),
      'E-way bills retrieved',
    );
  }

  @Post('dispatches/:id/eway-bill/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate e-way bill' })
  async validateEway(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const eway = await this.eway.validate(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.eway.toAdminView(eway), 'E-way bill validated');
  }

  @Post('dispatches/:id/eway-bill/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel e-way bill' })
  async cancelEway(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const eway = await this.eway.cancel(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.eway.toAdminView(eway), 'E-way bill cancelled');
  }

  @Post('dispatches/:id/start-loading')
  @HttpCode(HttpStatus.OK)
  async startLoading(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const dispatch = await this.dispatches.startLoading(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.dispatches.toAdminView(dispatch),
      'Loading started',
    );
  }

  @Post('dispatches/:id/complete-loading')
  @HttpCode(HttpStatus.OK)
  async completeLoading(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const dispatch = await this.dispatches.completeLoading(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.dispatches.toAdminView(dispatch),
      'Loading completed',
    );
  }

  @Post('dispatches/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  async executeDispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.dispatches.executeDispatch(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      {
        dispatch: this.dispatches.toAdminView(result.dispatch),
        shipment: this.shipments.toAdminView(result.shipment as never),
        delivery: this.deliveries.toAdminView(result.delivery as never),
      },
      'Dispatch executed',
    );
  }

  @Get('shipments')
  @ApiOperation({ summary: 'List all shipments' })
  async listShipments(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.shipments.list({
      skip,
      take,
      status: query.shipmentStatus,
    });
    return successResponse(
      items.map((s) => this.shipments.toAdminView(s)),
      'Shipments retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('shipments/:id')
  async getShipment(@Param('id', ParseUUIDPipe) id: string) {
    const shipment = await this.shipments.get(id);
    return successResponse(
      this.shipments.toAdminView(shipment),
      'Shipment retrieved',
    );
  }

  @Get('shipments/:id/tracking')
  async getTracking(@Param('id', ParseUUIDPipe) id: string) {
    const shipment = await this.shipments.get(id);
    return successResponse(
      this.shipments.toAdminView(shipment).trackingEvents,
      'Tracking retrieved',
    );
  }

  @Post('shipments/:id/tracking-events')
  @HttpCode(HttpStatus.OK)
  async addTracking(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TrackingEventDto,
  ) {
    const result = await this.shipments.addTrackingEvent(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.shipments.toAdminView(result.shipment),
      'Tracking event added',
    );
  }

  @Post('shipments/:id/eta')
  @HttpCode(HttpStatus.OK)
  async updateEta(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateEtaDto,
  ) {
    const shipment = await this.shipments.updateEta(id, body.eta, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.shipments.toAdminView(shipment), 'ETA updated');
  }

  @Get('deliveries')
  async listDeliveries(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.deliveries.list({
      skip,
      take,
      status: query.deliveryStatus,
    });
    return successResponse(
      items.map((d) => this.deliveries.toAdminView(d)),
      'Deliveries retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Get('deliveries/:id')
  async getDelivery(@Param('id', ParseUUIDPipe) id: string) {
    const delivery = await this.deliveries.get(id);
    return successResponse(
      this.deliveries.toAdminView(delivery),
      'Delivery retrieved',
    );
  }

  @Post('deliveries/:id/mark-delivered')
  @HttpCode(HttpStatus.OK)
  async markDelivered(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MarkDeliveredDto,
  ) {
    const delivery = await this.deliveries.markDelivered(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.deliveries.toAdminView(delivery),
      'Delivery marked delivered',
    );
  }

  @Post('deliveries/:id/upload-pod')
  @HttpCode(HttpStatus.OK)
  async uploadPod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadPodDto,
  ) {
    const delivery = await this.deliveries.uploadPod(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.deliveries.toAdminView(delivery),
      'POD metadata saved',
    );
  }

  @Post('deliveries/:id/mark-exception')
  @HttpCode(HttpStatus.OK)
  async markException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DeliveryExceptionDto,
  ) {
    const delivery = await this.deliveries.markException(id, body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.deliveries.toAdminView(delivery),
      'Delivery exception recorded',
    );
  }

  @Post('deliveries/:id/resolve-exception')
  @HttpCode(HttpStatus.OK)
  async resolveException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const delivery = await this.deliveries.resolveException(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(
      this.deliveries.toAdminView(delivery),
      'Delivery exception resolved',
    );
  }

  @Get('vehicles')
  async listVehicles(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.vehicles.list({ skip, take });
    return successResponse(
      items.map((v) => this.vehicles.toAdminView(v)),
      'Vehicles retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('vehicles')
  async createVehicle(
    @CurrentUser() _user: AuthenticatedUser,
    @Body() body: CreateVehicleDto & { organizationId?: string },
  ) {
    const vehicle = await this.vehicles.create(
      body.organizationId ?? null,
      body,
    );
    return successResponse(
      this.vehicles.toAdminView(vehicle),
      'Vehicle created',
    );
  }

  @Get('vehicles/:id')
  async getVehicle(@Param('id', ParseUUIDPipe) id: string) {
    const vehicle = await this.vehicles.get(id);
    return successResponse(
      this.vehicles.toAdminView(vehicle),
      'Vehicle retrieved',
    );
  }

  @Patch('vehicles/:id')
  async updateVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVehicleDto,
  ) {
    const vehicle = await this.vehicles.update(id, body);
    return successResponse(
      this.vehicles.toAdminView(vehicle),
      'Vehicle updated',
    );
  }

  @Get('drivers')
  async listDrivers(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.drivers.list({ skip, take });
    return successResponse(
      items.map((d) => this.drivers.toView(d)),
      'Drivers retrieved',
      paginationMeta(page, limit, total),
    );
  }

  @Post('drivers')
  async createDriver(
    @Body() body: CreateDriverDto & { organizationId?: string },
  ) {
    const driver = await this.drivers.create(body.organizationId ?? null, body);
    return successResponse(this.drivers.toView(driver), 'Driver created');
  }

  @Get('drivers/:id')
  async getDriver(@Param('id', ParseUUIDPipe) id: string) {
    const driver = await this.drivers.get(id);
    return successResponse(this.drivers.toView(driver), 'Driver retrieved');
  }

  @Patch('drivers/:id')
  async updateDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDriverDto,
  ) {
    const driver = await this.drivers.update(id, body);
    return successResponse(this.drivers.toView(driver), 'Driver updated');
  }

  @Get('vehicle-slots')
  async listSlots(@Query() query: LogisticsListQueryDto) {
    const { skip, take, page, limit } = skipTake(query.page, query.limit);
    const { items, total } = await this.slots.list({
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

  @Get('vehicle-slots/:id')
  async getSlot(@Param('id', ParseUUIDPipe) id: string) {
    const slot = await this.slots.get(id);
    return successResponse(this.slots.toView(slot), 'Vehicle slot retrieved');
  }

  @Post('vehicle-slots')
  async createSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateVehicleSlotDto,
  ) {
    const slot = await this.slots.create(body, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.slots.toView(slot), 'Vehicle slot created');
  }

  @Post('vehicle-slots/:id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const slot = await this.slots.confirm(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.slots.toView(slot), 'Vehicle slot confirmed');
  }

  @Post('vehicle-slots/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const slot = await this.slots.cancel(id, {
      userId: user.id,
      role: 'ADMIN',
    });
    return successResponse(this.slots.toView(slot), 'Vehicle slot cancelled');
  }
}
