import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ImportSide, PortType } from '../../generated/prisma/client.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { ImportFeatureGuard } from './common/import-feature.guard.js';
import { ImportMasterService } from './common/import-master.service.js';
import { ImportDealsService } from './deals/import-deals.service.js';
import {
  CreateImportDocumentDto,
  ImportListingDocumentsService,
} from './documents/import-listing-documents.service.js';
import {
  CancelImportListingDto,
  CreateImportListingDto,
  ListImportListingsQueryDto,
  UpdateImportListingDto,
} from './listings/dto/import-listing.dto.js';
import { ImportListingsService } from './listings/import-listings.service.js';
import {
  CounterOfferDto,
  ListDealsQueryDto,
  ListNegotiationsQueryDto,
  NegotiationNoteDto,
  OpenNegotiationDto,
} from './negotiations/dto/import-negotiation.dto.js';
import { ImportNegotiationsService } from './negotiations/import-negotiations.service.js';

const TRADERS = [RoleCode.CUSTOMER, RoleCode.SELLER] as const;
const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Client-generated key (8-128 chars). Retries with the same key replay the first result.',
};

@ApiTags('Import - Config')
@Controller({ path: 'import', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
export class ImportConfigController {
  constructor(
    private readonly config: ConfigService,
    private readonly listings: ImportListingsService,
  ) {}

  @Get('config')
  @Roles(...TRADERS, RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({
    summary:
      'Import feature flag (clients hide Import navigation when disabled)',
  })
  getConfig() {
    return successResponse(
      {
        enabled: this.config.get<boolean>('import.enabled') !== false,
        serverTime: new Date(),
      },
      'Import configuration',
    );
  }

  @Get('summary')
  @UseGuards(ImportFeatureGuard)
  @Roles(...TRADERS)
  @ApiOperation({ summary: 'Import dashboard counters for the caller' })
  async summary(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(await this.listings.summary(user), 'Import summary');
  }
}

@ApiTags('Import - Master Data')
@Controller({ path: 'import/master-data', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
@Roles(...TRADERS)
export class ImportMasterDataController {
  constructor(private readonly master: ImportMasterService) {}

  @Get()
  @ApiOperation({
    summary:
      'All Import form options (currencies, Incoterms, payment terms, enums...)',
  })
  async bundle() {
    return successResponse(await this.master.bundle(), 'Import master data');
  }

  @Get('products')
  async products(@Query('search') search?: string) {
    return successResponse(
      await this.master.products(search?.trim() || undefined),
      'Products',
    );
  }

  @Get('grades')
  @ApiQuery({ name: 'categoryId', required: false })
  async grades(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { items, meta } = await this.master.grades({
      categoryId: categoryId || undefined,
      search: search?.trim() || undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return successResponse(items, 'Grades', meta);
  }

  @Get('brands')
  async brands(
    @Query('search') search?: string,
    @Query('countryId') countryId?: string,
  ) {
    return successResponse(
      await this.master.brands({
        search: search?.trim() || undefined,
        countryId: countryId || undefined,
      }),
      'Brands',
    );
  }

  @Get('ports')
  @ApiQuery({ name: 'type', required: false, enum: PortType })
  async ports(
    @Query('search') search?: string,
    @Query('countryCode') countryCode?: string,
    @Query('type') type?: PortType,
  ) {
    return successResponse(
      await this.master.ports({
        search: search?.trim() || undefined,
        countryCode: countryCode || undefined,
        type: type && Object.values(PortType).includes(type) ? type : undefined,
      }),
      'Ports',
    );
  }

  @Get('countries')
  async countries(@Query('search') search?: string) {
    return successResponse(
      await this.master.countries(search?.trim() || undefined),
      'Countries',
    );
  }

  @Get('payment-terms')
  @ApiQuery({
    name: 'currencyCode',
    required: false,
    description: 'Only terms applicable to this currency',
  })
  async paymentTerms(@Query('currencyCode') currencyCode?: string) {
    return successResponse(
      await this.master.paymentTerms(currencyCode),
      'Import payment terms',
    );
  }
}

@ApiTags('Import - BUY Requests (RFQ)')
@Controller({ path: 'import/buy', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
export class ImportBuyController {
  constructor(private readonly listings: ImportListingsService) {}

  @Post()
  @Roles(RoleCode.CUSTOMER)
  @ApiOperation({ summary: 'Create a BUY request draft' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImportListingDto,
  ) {
    return successResponse(
      await this.listings.create(user, ImportSide.BUY, dto),
      'Import BUY draft created',
    );
  }

  @Get()
  @Roles(...TRADERS)
  @ApiOperation({
    summary:
      'List BUY requests (scope=mine for customers, scope=market for sellers)',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListImportListingsQueryDto,
  ) {
    const { items, meta } = await this.listings.list(
      user,
      ImportSide.BUY,
      query,
    );
    return successResponse(items, 'Import BUY requests', meta);
  }

  @Get(':id')
  @Roles(...TRADERS)
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.get(user, ImportSide.BUY, id),
      'Import BUY request',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.CUSTOMER)
  @ApiOperation({
    summary: 'Autosave a draft or edit allowed terms of a live request',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImportListingDto,
  ) {
    return successResponse(
      await this.listings.update(user, ImportSide.BUY, id, dto),
      'Import BUY request saved',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.CUSTOMER)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.remove(user, ImportSide.BUY, id),
      'Draft deleted',
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.CUSTOMER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.listings.publish(user, ImportSide.BUY, id, key),
      'Import BUY request published',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.CUSTOMER)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelImportListingDto,
  ) {
    return successResponse(
      await this.listings.cancel(user, ImportSide.BUY, id, dto.reason),
      'Import BUY request cancelled',
    );
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.CUSTOMER)
  async expire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.expire(user, ImportSide.BUY, id),
      'Import BUY request expired',
    );
  }

  @Get(':id/matches')
  @Roles(RoleCode.CUSTOMER)
  @ApiOperation({
    summary:
      'Rule-based matching SELL offers with score and matched/unmatched criteria',
  })
  async matches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.matches(user, ImportSide.BUY, id),
      'Matches',
    );
  }

  @Post(':id/matches/:matchId/dismiss')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.CUSTOMER)
  async dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ) {
    return successResponse(
      await this.listings.dismissMatch(user, ImportSide.BUY, id, matchId),
      'Match dismissed',
    );
  }
}

@ApiTags('Import - SELL Offers')
@Controller({ path: 'import/sell', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
export class ImportSellController {
  constructor(private readonly listings: ImportListingsService) {}

  @Post()
  @Roles(RoleCode.SELLER)
  @ApiOperation({ summary: 'Create a SELL offer draft' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImportListingDto,
  ) {
    return successResponse(
      await this.listings.create(user, ImportSide.SELL, dto),
      'Import SELL draft created',
    );
  }

  @Get()
  @Roles(...TRADERS)
  @ApiOperation({
    summary:
      'List SELL offers (scope=mine for sellers, scope=market for customers)',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListImportListingsQueryDto,
  ) {
    const { items, meta } = await this.listings.list(
      user,
      ImportSide.SELL,
      query,
    );
    return successResponse(items, 'Import SELL offers', meta);
  }

  @Get(':id')
  @Roles(...TRADERS)
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.get(user, ImportSide.SELL, id),
      'Import SELL offer',
    );
  }

  @Patch(':id')
  @Roles(RoleCode.SELLER)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateImportListingDto,
  ) {
    return successResponse(
      await this.listings.update(user, ImportSide.SELL, id, dto),
      'Import SELL offer saved',
    );
  }

  @Delete(':id')
  @Roles(RoleCode.SELLER)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.remove(user, ImportSide.SELL, id),
      'Draft deleted',
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  @ApiHeader(IDEMPOTENCY_HEADER)
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.listings.publish(user, ImportSide.SELL, id, key),
      'Import SELL offer published',
    );
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.pause(user, ImportSide.SELL, id),
      'Import SELL offer paused',
    );
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.resume(user, ImportSide.SELL, id),
      'Import SELL offer resumed',
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelImportListingDto,
  ) {
    return successResponse(
      await this.listings.cancel(user, ImportSide.SELL, id, dto.reason),
      'Import SELL offer cancelled',
    );
  }

  @Post(':id/expire')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  async expire(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.expire(user, ImportSide.SELL, id),
      'Import SELL offer expired',
    );
  }

  @Get(':id/matches')
  @Roles(RoleCode.SELLER)
  async matches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.listings.matches(user, ImportSide.SELL, id),
      'Matches',
    );
  }

  @Post(':id/matches/:matchId/dismiss')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleCode.SELLER)
  async dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ) {
    return successResponse(
      await this.listings.dismissMatch(user, ImportSide.SELL, id, matchId),
      'Match dismissed',
    );
  }
}

@ApiTags('Import - Listing Documents')
@Controller({ path: 'import/listings/:listingId/documents', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
@Roles(...TRADERS)
export class ImportListingDocumentsController {
  constructor(private readonly documents: ImportListingDocumentsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    return successResponse(
      await this.documents.list(user, listingId),
      'Listing documents',
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Register a document and get a signed R2 upload URL',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: CreateImportDocumentDto,
  ) {
    return successResponse(
      await this.documents.create(user, listingId, dto),
      'Upload URL issued',
    );
  }

  @Post(':documentId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.documents.confirm(user, listingId, documentId),
      'Document uploaded',
    );
  }

  @Get(':documentId/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('disposition') disposition?: string,
  ) {
    return successResponse(
      await this.documents.download(
        user,
        listingId,
        documentId,
        disposition === 'attachment' ? 'attachment' : 'inline',
      ),
      'Download URL issued',
    );
  }

  @Delete(':documentId')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return successResponse(
      await this.documents.remove(user, listingId, documentId),
      'Document removed',
    );
  }
}

@ApiTags('Import - Negotiations')
@Controller({ path: 'import/negotiations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
@Roles(...TRADERS)
export class ImportNegotiationsController {
  constructor(private readonly negotiations: ImportNegotiationsService) {}

  @Post()
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary: 'Respond to a counterparty listing with price/quantity/terms',
  })
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OpenNegotiationDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.negotiations.open(user, dto, key),
      'Negotiation started',
    );
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNegotiationsQueryDto,
  ) {
    const { items, meta } = await this.negotiations.list(user, query);
    return successResponse(items, 'Negotiations', meta);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.negotiations.get(user, id),
      'Negotiation',
    );
  }

  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER)
  async counter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CounterOfferDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.negotiations.counter(user, id, dto, key),
      'Counteroffer sent',
    );
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER)
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.negotiations.accept(user, id, key),
      'Terms accepted',
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NegotiationNoteDto,
  ) {
    return successResponse(
      await this.negotiations.reject(user, id, dto),
      'Offer rejected',
    );
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NegotiationNoteDto,
  ) {
    return successResponse(
      await this.negotiations.withdraw(user, id, dto),
      'Negotiation withdrawn',
    );
  }
}

@ApiTags('Import - Deals')
@Controller({ path: 'import/deals', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, ImportFeatureGuard)
@ApiBearerAuth('bearer')
@Roles(...TRADERS)
export class ImportDealsController {
  constructor(private readonly deals: ImportDealsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListDealsQueryDto,
  ) {
    const { items, meta } = await this.deals.list(user, query);
    return successResponse(items, 'Deals', meta);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(await this.deals.get(user, id), 'Deal');
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(IDEMPOTENCY_HEADER)
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return successResponse(
      await this.deals.confirm(user, id, key),
      'Deal confirmed',
    );
  }
}
