import { Injectable } from '@nestjs/common';
import {
  EntityOwnerType,
  LocationType,
  MasterStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import {
  IMPORT_AUDIT_ACTIONS,
  ImportAuditService,
} from '../common/import-audit.service.js';
import {
  ImportException,
  type ImportFieldError,
  throwFieldErrors,
} from '../domain/import.errors.js';
import type {
  ImportMasterEntity,
  ImportMasterQueryDto,
  ImportMasterRecordDto,
} from './dto/admin-import.dto.js';

type Row = {
  id: string;
  code: string;
  status: MasterStatus;
  deletedAt: Date | null;
} & Record<string, unknown>;

/** Minimal delegate surface shared by every master table used here. */
type Delegate = {
  findMany(args: unknown): Promise<Row[]>;
  count(args: unknown): Promise<number>;
  findFirst(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
};

type EntityConfig = {
  label: string;
  fields: Array<keyof ImportMasterRecordDto>;
  required: Array<keyof ImportMasterRecordDto>;
  codePattern?: RegExp;
  codeHint?: string;
  hasSortOrder: boolean;
  include?: Record<string, unknown>;
};

const CONFIG: Record<ImportMasterEntity, EntityConfig> = {
  currencies: {
    label: 'currency',
    fields: [
      'code',
      'name',
      'symbol',
      'decimalPlaces',
      'importEnabled',
      'sortOrder',
    ],
    required: ['code', 'name'],
    codePattern: /^[A-Z]{3}$/,
    codeHint: 'ISO 4217 code, e.g. USD',
    hasSortOrder: true,
  },
  incoterms: {
    label: 'Incoterm',
    fields: ['code', 'name', 'description', 'priceBasis', 'sortOrder'],
    required: ['code', 'name', 'priceBasis'],
    hasSortOrder: true,
  },
  brands: {
    label: 'brand',
    fields: ['code', 'name', 'countryId', 'sortOrder'],
    required: ['code', 'name'],
    hasSortOrder: true,
    include: { country: { select: { id: true, code: true, name: true } } },
  },
  ports: {
    label: 'port',
    fields: ['code', 'name', 'countryId', 'type', 'sortOrder'],
    required: ['code', 'name', 'countryId'],
    codePattern: /^[A-Z]{2}[A-Z0-9]{3}$/,
    codeHint: 'UN/LOCODE, e.g. INMUN',
    hasSortOrder: true,
    include: { country: { select: { id: true, code: true, name: true } } },
  },
  packaging: {
    label: 'packaging',
    fields: ['code', 'name', 'sortOrder'],
    required: ['code', 'name'],
    hasSortOrder: true,
  },
  'document-requirements': {
    label: 'document requirement',
    fields: ['code', 'name', 'description', 'documentCategory', 'sortOrder'],
    required: ['code', 'name', 'documentCategory'],
    hasSortOrder: true,
  },
  countries: {
    label: 'country',
    fields: ['code', 'name'],
    required: ['code', 'name'],
    codePattern: /^[A-Z]{2}$/,
    codeHint: 'ISO 3166-1 alpha-2, e.g. IN',
    hasSortOrder: false,
  },
};

@Injectable()
export class AdminImportMasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ImportAuditService,
  ) {}

  private delegate(entity: ImportMasterEntity): Delegate {
    const map: Record<ImportMasterEntity, unknown> = {
      currencies: this.prisma.currency,
      incoterms: this.prisma.incoterm,
      brands: this.prisma.brand,
      ports: this.prisma.port,
      packaging: this.prisma.packaging,
      'document-requirements': this.prisma.documentRequirement,
      countries: this.prisma.location,
    };
    return map[entity] as Delegate;
  }

  private baseWhere(entity: ImportMasterEntity): Record<string, unknown> {
    return entity === 'countries'
      ? { type: LocationType.COUNTRY, deletedAt: null }
      : { deletedAt: null };
  }

  async list(entity: ImportMasterEntity, query: ImportMasterQueryDto) {
    const cfg = CONFIG[entity];
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const search = resolveSearch(query);
    const where = {
      ...this.baseWhere(entity),
      ...(query.status ? { status: query.status } : {}),
      ...(query.countryCode && (entity === 'ports' || entity === 'countries')
        ? entity === 'ports'
          ? { countryCode: query.countryCode.toUpperCase() }
          : { code: query.countryCode.toUpperCase() }
        : {}),
      ...(search
        ? {
            OR: [
              {
                code: { contains: search, mode: Prisma.QueryMode.insensitive },
              },
              {
                name: { contains: search, mode: Prisma.QueryMode.insensitive },
              },
            ],
          }
        : {}),
    };
    const d = this.delegate(entity);
    const [items, total] = await Promise.all([
      d.findMany({
        where,
        ...(cfg.include ? { include: cfg.include } : {}),
        orderBy: cfg.hasSortOrder
          ? [{ sortOrder: 'asc' }, { name: 'asc' }]
          : [{ name: 'asc' }],
        skip,
        take,
      }),
      d.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  private async pick(
    entity: ImportMasterEntity,
    dto: ImportMasterRecordDto,
    creating: boolean,
  ) {
    const cfg = CONFIG[entity];
    const errors: ImportFieldError[] = [];
    const data: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      if (dto[f] !== undefined)
        data[f] =
          typeof dto[f] === 'string' ? (dto[f] as string).trim() : dto[f];
    }
    if (creating) {
      for (const f of cfg.required) {
        if (data[f] === undefined || data[f] === '') {
          errors.push({
            field: f,
            code: 'REQUIRED',
            message: `${f} is required.`,
          });
        }
      }
    }
    if (typeof data.code === 'string') {
      const code = data.code.toUpperCase();
      data.code = code;
      if (cfg.codePattern && !cfg.codePattern.test(code)) {
        errors.push({
          field: 'code',
          code: 'IMPORT_VALIDATION_FAILED',
          message: `Code must be a ${cfg.codeHint}.`,
        });
      }
    }
    if (data.countryId) {
      const country = await this.prisma.location.findFirst({
        where: {
          id: data.countryId as string,
          type: LocationType.COUNTRY,
          deletedAt: null,
        },
      });
      if (!country) {
        errors.push({
          field: 'countryId',
          code: 'INVALID_MASTER_REFERENCE',
          message: 'Country not found.',
        });
      } else if (entity === 'ports') {
        data.countryCode = country.code;
      }
    }
    throwFieldErrors(errors);
    if (entity === 'countries') {
      if (creating) data.type = LocationType.COUNTRY;
      if (data.code) data.countryCode = data.code;
    }
    return data;
  }

  private async find(entity: ImportMasterEntity, id: string) {
    const row = await this.delegate(entity).findFirst({
      where: { id, ...this.baseWhere(entity) },
    });
    if (!row)
      throw new ImportException(
        'IMPORT_NOT_FOUND',
        `${CONFIG[entity].label} not found.`,
      );
    return row;
  }

  private rethrowUnique(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ImportException('IMPORT_MASTER_CONFLICT');
    }
    throw error;
  }

  async create(
    entity: ImportMasterEntity,
    dto: ImportMasterRecordDto,
    actorUserId: string,
    actorRole: string,
  ) {
    const data = await this.pick(entity, dto, true);
    let row: Row;
    try {
      row = await this.delegate(entity).create({
        data: { ...data, status: MasterStatus.ACTIVE },
      });
    } catch (error) {
      this.rethrowUnique(error);
    }
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.MASTER_CREATED,
      actorUserId,
      actorRole,
      entityType: EntityOwnerType.IMPORT_MASTER,
      entityId: row.id,
      newData: row,
      metadata: { entity, code: row.code },
    });
    return row;
  }

  async update(
    entity: ImportMasterEntity,
    id: string,
    dto: ImportMasterRecordDto,
    actorUserId: string,
    actorRole: string,
  ) {
    const before = await this.find(entity, id);
    const data = await this.pick(entity, dto, false);
    let row: Row;
    try {
      row = await this.delegate(entity).update({ where: { id }, data });
    } catch (error) {
      this.rethrowUnique(error);
    }
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.MASTER_UPDATED,
      actorUserId,
      actorRole,
      entityType: EntityOwnerType.IMPORT_MASTER,
      entityId: id,
      previousData: Object.fromEntries(
        Object.keys(data).map((k) => [k, before[k] ?? null]),
      ),
      newData: data,
      metadata: { entity, code: row.code },
    });
    return row;
  }

  /**
   * Soft enable/disable. Disabled values disappear from new forms but existing
   * listings keep their publish-time snapshot, so history is untouched.
   */
  async setStatus(
    entity: ImportMasterEntity,
    id: string,
    status: MasterStatus,
    actorUserId: string,
    actorRole: string,
  ) {
    const before = await this.find(entity, id);
    const row = await this.delegate(entity).update({
      where: { id },
      data: { status },
    });
    await this.audit.log({
      action: IMPORT_AUDIT_ACTIONS.MASTER_STATUS_CHANGED,
      actorUserId,
      actorRole,
      entityType: EntityOwnerType.IMPORT_MASTER,
      entityId: id,
      previousData: { status: before.status },
      newData: { status },
      metadata: { entity, code: row.code },
    });
    return row;
  }
}
