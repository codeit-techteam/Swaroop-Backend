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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { MasterStatus } from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { ImportException } from '../domain/import.errors.js';
import { AdminImportMasterService } from './admin-import-master.service.js';
import { AdminImportService, type AdminActor } from './admin-import.service.js';
import {
  AdminDealStatusDto,
  AdminDealsQueryDto,
  AdminImportAuditQueryDto,
  AdminImportDocumentDownloadQueryDto,
  AdminImportDocumentsQueryDto,
  AdminListingStatusDto,
  AdminListingsQueryDto,
  AdminMatchesQueryDto,
  AdminNegotiationsQueryDto,
  IMPORT_MASTER_ENTITIES,
  ImportMasterQueryDto,
  ImportMasterRecordDto,
  UpdateImportSettingsDto,
  type ImportMasterEntity,
} from './dto/admin-import.dto.js';
import {
  AddImportShipmentEventDto,
  AdminImportShipmentsQueryDto,
  UpdateImportShipmentDto,
} from '../shipments/dto/import-shipment.dto.js';
import { ImportShipmentsService } from '../shipments/import-shipments.service.js';

const WRITE_ROLES = [RoleCode.ADMIN, RoleCode.SUPER_ADMIN] as const;
const READ_ROLES = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.OPERATIONS_MANAGER,
  RoleCode.PROCUREMENT_MANAGER,
] as const;

function actorOf(user: AuthenticatedUser): AdminActor {
  const roles = user.roles ?? [];
  return {
    userId: user.id,
    role: roles.includes(RoleCode.SUPER_ADMIN)
      ? RoleCode.SUPER_ADMIN
      : (roles[0] ?? RoleCode.ADMIN),
  };
}

function entityOf(value: string): ImportMasterEntity {
  if (!(IMPORT_MASTER_ENTITIES as readonly string[]).includes(value)) {
    throw new ImportException(
      'IMPORT_NOT_FOUND',
      `Unknown Import master entity "${value}".`,
    );
  }
  return value as ImportMasterEntity;
}

/** Admin master data stays manageable even when IMPORT_FEATURE_ENABLED=false. */
@ApiTags('Admin - Import Master Data')
@Controller({ path: 'admin/import/master-data', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class AdminImportMasterController {
  constructor(private readonly master: AdminImportMasterService) {}

  @Get(':entity')
  @Roles(...READ_ROLES)
  @ApiParam({ name: 'entity', enum: IMPORT_MASTER_ENTITIES })
  async list(
    @Param('entity') entity: string,
    @Query() query: ImportMasterQueryDto,
  ) {
    const { items, meta } = await this.master.list(entityOf(entity), query);
    return successResponse(items, 'Import master data', meta);
  }

  @Post(':entity')
  @Roles(...WRITE_ROLES)
  @ApiParam({ name: 'entity', enum: IMPORT_MASTER_ENTITIES })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Body() dto: ImportMasterRecordDto,
  ) {
    const a = actorOf(user);
    return successResponse(
      await this.master.create(entityOf(entity), dto, a.userId, a.role),
      'Created',
    );
  }

  @Patch(':entity/:id')
  @Roles(...WRITE_ROLES)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportMasterRecordDto,
  ) {
    const a = actorOf(user);
    return successResponse(
      await this.master.update(entityOf(entity), id, dto, a.userId, a.role),
      'Updated',
    );
  }

  @Post(':entity/:id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = actorOf(user);
    return successResponse(
      await this.master.setStatus(
        entityOf(entity),
        id,
        MasterStatus.ACTIVE,
        a.userId,
        a.role,
      ),
      'Activated',
    );
  }

  @Post(':entity/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  @ApiOperation({
    summary: 'Soft-disable (hidden from new forms; history keeps snapshots)',
  })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entity') entity: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = actorOf(user);
    return successResponse(
      await this.master.setStatus(
        entityOf(entity),
        id,
        MasterStatus.INACTIVE,
        a.userId,
        a.role,
      ),
      'Deactivated',
    );
  }
}

@ApiTags('Admin - Import Trading')
@Controller({ path: 'admin/import', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class AdminImportController {
  constructor(
    private readonly admin: AdminImportService,
    private readonly shipments: ImportShipmentsService,
  ) {}

  @Get('settings')
  @Roles(...READ_ROLES)
  async settings() {
    return successResponse(await this.admin.getSettings(), 'Import settings');
  }

  @Patch('settings')
  @Roles(...WRITE_ROLES)
  @ApiOperation({
    summary:
      'Update matching weights, minimum score, custom grade policy, expiry windows',
  })
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateImportSettingsDto,
  ) {
    return successResponse(
      await this.admin.updateSettings(dto, actorOf(user)),
      'Import settings updated',
    );
  }

  @Get('dashboard')
  @Roles(...READ_ROLES)
  async dashboard() {
    return successResponse(await this.admin.dashboard(), 'Import dashboard');
  }

  @Get('listings')
  @Roles(...READ_ROLES)
  async listings(@Query() query: AdminListingsQueryDto) {
    const { items, meta } = await this.admin.listListings(query);
    return successResponse(items, 'Import listings', meta);
  }

  @Get('listings/:id')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary:
      'Full listing detail: identities, negotiations + events, matches, deals, documents, audit trail',
  })
  async listing(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.admin.listingDetail(id),
      'Import listing',
    );
  }

  @Post('listings/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async listingStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminListingStatusDto,
  ) {
    return successResponse(
      await this.admin.setListingStatus(
        id,
        dto.status,
        dto.reason,
        actorOf(user),
      ),
      'Listing status updated',
    );
  }

  @Post('listings/:id/rematch')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async rematch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.admin.rematch(id, actorOf(user)),
      'Matches recomputed',
    );
  }

  @Get('negotiations')
  @Roles(...READ_ROLES)
  async negotiations(@Query() query: AdminNegotiationsQueryDto) {
    const { items, meta } = await this.admin.listNegotiations(query);
    return successResponse(items, 'Import negotiations', meta);
  }

  @Get('negotiations/:id')
  @Roles(...READ_ROLES)
  async negotiation(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.admin.negotiationDetail(id),
      'Import negotiation',
    );
  }

  @Get('deals')
  @Roles(...READ_ROLES)
  async deals(@Query() query: AdminDealsQueryDto) {
    const { items, meta } = await this.admin.listDeals(query);
    return successResponse(items, 'Import deals', meta);
  }

  @Get('deals/:id')
  @Roles(...READ_ROLES)
  async deal(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.admin.dealDetail(id), 'Import deal');
  }

  @Post('deals/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  async dealStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDealStatusDto,
  ) {
    return successResponse(
      await this.admin.setDealStatus(id, dto.status, dto.reason, actorOf(user)),
      'Deal status updated',
    );
  }

  @Get('matches')
  @Roles(...READ_ROLES)
  async matches(@Query() query: AdminMatchesQueryDto) {
    const { items, meta } = await this.admin.listMatches(query);
    return successResponse(items, 'Import matches', meta);
  }

  @Get('documents')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary: 'All Import listing documents across buy requests and sell offers',
  })
  async documents(@Query() query: AdminImportDocumentsQueryDto) {
    const { items, meta } = await this.admin.listDocuments(query);
    return successResponse(items, 'Import documents', meta);
  }

  @Get('documents/:id/download')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary:
      'Short-lived signed URL for an Import document (access is audited)',
  })
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AdminImportDocumentDownloadQueryDto,
  ) {
    return successResponse(
      await this.admin.downloadDocument(id, query.disposition, actorOf(user)),
      'Download URL generated',
    );
  }

  @Get('audit-logs')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary:
      'Import audit trail across listings, negotiations, deals and masters',
  })
  async auditLogs(@Query() query: AdminImportAuditQueryDto) {
    const { items, meta } = await this.admin.listAuditLogs(query);
    return successResponse(items, 'Import audit logs', meta);
  }

  @Get('shipments')
  @Roles(...READ_ROLES)
  @ApiOperation({
    summary: 'All Import shipments with buyer/seller identities',
  })
  async shipmentList(@Query() query: AdminImportShipmentsQueryDto) {
    const { items, meta } = await this.shipments.adminList(query);
    return successResponse(items, 'Import shipments', meta);
  }

  @Get('shipments/:id')
  @Roles(...READ_ROLES)
  async shipment(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.admin.shipmentDetail(id),
      'Import shipment',
    );
  }

  @Patch('shipments/:id')
  @Roles(...WRITE_ROLES)
  async updateShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImportShipmentDto,
  ) {
    await this.shipments.adminUpdate(id, dto, actorOf(user));
    return successResponse(
      await this.admin.shipmentDetail(id),
      'Shipment updated',
    );
  }

  @Post('shipments/:id/events')
  @HttpCode(HttpStatus.OK)
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Record a tracking update or status change' })
  async shipmentEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddImportShipmentEventDto,
  ) {
    await this.shipments.adminAddEvent(id, dto, actorOf(user));
    return successResponse(
      await this.admin.shipmentDetail(id),
      'Shipment updated',
    );
  }
}
