import { Injectable } from '@nestjs/common';
import {
  GradeStatus,
  ImportContainerSize,
  ImportGstTreatment,
  ImportInspectionType,
  ImportPriceType,
  ImportQuantityUnit,
  ImportReadyStockType,
  ImportShipmentMode,
  ImportShipmentPermission,
  ImportShipmentStatus,
  ImportShipmentType,
  LocationType,
  MasterStatus,
  PortType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import type { ImportFieldError } from '../domain/import.errors.js';
import { ImportSettingsService } from './import-settings.service.js';

export type ListingReferenceIds = {
  categoryId?: string | null;
  gradeId?: string | null;
  brandId?: string | null;
  originCountryId?: string | null;
  packagingId?: string | null;
  currencyId?: string | null;
  incotermId?: string | null;
  priceBasisPortId?: string | null;
  paymentTermId?: string | null;
  polId?: string | null;
  podId?: string | null;
  documentRequirementIds?: string[];
};

type Named = { id: string; code: string; name: string };

export type ListingSnapshot = {
  capturedAt: string;
  category: Named | null;
  grade: (Named & { categoryId: string }) | null;
  customGradeName: string | null;
  brand: Named | null;
  originCountry: Named | null;
  packaging: Named | null;
  currency: (Named & { symbol: string | null; decimalPlaces: number }) | null;
  incoterm: (Named & { priceBasis: string }) | null;
  priceBasisPort: (Named & { countryCode: string }) | null;
  paymentTerm:
    (Named & { method: string | null; currencyCodes: string[] }) | null;
  pol: (Named & { countryCode: string }) | null;
  pod: (Named & { countryCode: string }) | null;
  documentRequirements: Array<Named & { documentCategory: string | null }>;
};

export type ResolvedReferences = {
  snapshot: ListingSnapshot;
  currencyCode: string | null;
  paymentTermCurrencyCodes: string[] | null;
  errors: ImportFieldError[];
};

const ACTIVE = MasterStatus.ACTIVE;
const insensitive = (search?: string) =>
  search ? { contains: search, mode: Prisma.QueryMode.insensitive } : undefined;

@Injectable()
export class ImportMasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ImportSettingsService,
  ) {}

  /** Everything an Import form needs in one round trip. */
  async bundle() {
    const [
      currencies,
      incoterms,
      packaging,
      documentRequirements,
      countries,
      paymentTerms,
      settings,
    ] = await Promise.all([
      this.prisma.currency.findMany({
        where: { status: ACTIVE, importEnabled: true, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          symbol: true,
          decimalPlaces: true,
        },
      }),
      this.prisma.incoterm.findMany({
        where: { status: ACTIVE, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          priceBasis: true,
        },
      }),
      this.prisma.packaging.findMany({
        where: { status: ACTIVE, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
      this.prisma.documentRequirement.findMany({
        where: { status: ACTIVE, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          documentCategory: true,
        },
      }),
      this.countries(),
      this.paymentTerms(),
      this.settings.get(),
    ]);

    return {
      currencies,
      defaultCurrencyCode: currencies[0]?.code ?? null,
      incoterms,
      packaging,
      documentRequirements,
      countries,
      paymentTerms,
      allowCustomGrade: settings.allowCustomGrade,
      buyRequestValidityDays: settings.buyRequestValidityDays,
      enums: {
        quantityUnits: Object.values(ImportQuantityUnit),
        priceTypes: Object.values(ImportPriceType),
        gstTreatments: Object.values(ImportGstTreatment),
        shipmentPermissions: Object.values(ImportShipmentPermission),
        shipmentTypes: Object.values(ImportShipmentType),
        containerSizes: Object.values(ImportContainerSize),
        inspectionTypes: Object.values(ImportInspectionType),
        readyStockTypes: Object.values(ImportReadyStockType),
        portTypes: Object.values(PortType),
        shipmentModes: Object.values(ImportShipmentMode),
        shipmentStatuses: Object.values(ImportShipmentStatus),
      },
    };
  }

  products(search?: string) {
    return this.prisma.gradeCategory.findMany({
      where: {
        status: ACTIVE,
        isActive: true,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: insensitive(search) },
                { displayName: insensitive(search) },
                { code: insensitive(search) },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        parentGroup: true,
      },
    });
  }

  async grades(query: {
    categoryId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit ?? 50);
    const where: Prisma.GradeWhereInput = {
      status: GradeStatus.ACTIVE,
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: insensitive(query.search) },
              { displayName: insensitive(query.search) },
              { code: insensitive(query.search) },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.grade.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          code: true,
          name: true,
          displayName: true,
          categoryId: true,
          hsnCode: true,
        },
      }),
      this.prisma.grade.count({ where }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  brands(query: { search?: string; countryId?: string }) {
    return this.prisma.brand.findMany({
      where: {
        status: ACTIVE,
        deletedAt: null,
        ...(query.countryId ? { countryId: query.countryId } : {}),
        ...(query.search
          ? {
              OR: [
                { name: insensitive(query.search) },
                { code: insensitive(query.search) },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        country: { select: { id: true, code: true, name: true } },
      },
    });
  }

  ports(query: { search?: string; countryCode?: string; type?: PortType }) {
    return this.prisma.port.findMany({
      where: {
        status: ACTIVE,
        deletedAt: null,
        ...(query.countryCode
          ? { countryCode: query.countryCode.toUpperCase() }
          : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.search
          ? {
              OR: [
                { name: insensitive(query.search) },
                { code: insensitive(query.search) },
              ],
            }
          : {}),
      },
      orderBy: [{ countryCode: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        countryCode: true,
        type: true,
      },
    });
  }

  countries(search?: string) {
    return this.prisma.location.findMany({
      where: {
        type: LocationType.COUNTRY,
        status: ACTIVE,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: insensitive(search) },
                { code: insensitive(search) },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  /** Import payment terms; when a currency is given only applicable terms are returned. */
  paymentTerms(currencyCode?: string) {
    const code = currencyCode?.trim().toUpperCase();
    return this.prisma.paymentTerm.findMany({
      where: {
        importEnabled: true,
        status: ACTIVE,
        deletedAt: null,
        ...(code
          ? {
              OR: [
                { currencyCodes: { has: code } },
                { currencyCodes: { isEmpty: true } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        method: true,
        paymentType: true,
        percentage: true,
        days: true,
        currencyCodes: true,
      },
    });
  }

  /**
   * Loads every master record a listing references, reports missing/inactive
   * ones as field errors and builds the immutable publish snapshot.
   */
  async resolve(
    ids: ListingReferenceIds,
    customGradeName: string | null,
  ): Promise<ResolvedReferences> {
    const errors: ImportFieldError[] = [];
    const docIds = ids.documentRequirementIds ?? [];
    const one = <T>(
      id: string | null | undefined,
      load: (id: string) => Promise<T | null>,
    ) => (id ? load(id) : Promise.resolve(null));

    const [
      category,
      grade,
      brand,
      origin,
      packaging,
      currency,
      incoterm,
      basisPort,
      term,
      pol,
      pod,
      docs,
    ] = await Promise.all([
      one(ids.categoryId, (id) =>
        this.prisma.gradeCategory.findUnique({ where: { id } }),
      ),
      one(ids.gradeId, (id) => this.prisma.grade.findUnique({ where: { id } })),
      one(ids.brandId, (id) => this.prisma.brand.findUnique({ where: { id } })),
      one(ids.originCountryId, (id) =>
        this.prisma.location.findUnique({ where: { id } }),
      ),
      one(ids.packagingId, (id) =>
        this.prisma.packaging.findUnique({ where: { id } }),
      ),
      one(ids.currencyId, (id) =>
        this.prisma.currency.findUnique({ where: { id } }),
      ),
      one(ids.incotermId, (id) =>
        this.prisma.incoterm.findUnique({ where: { id } }),
      ),
      one(ids.priceBasisPortId, (id) =>
        this.prisma.port.findUnique({ where: { id } }),
      ),
      one(ids.paymentTermId, (id) =>
        this.prisma.paymentTerm.findUnique({ where: { id } }),
      ),
      one(ids.polId, (id) => this.prisma.port.findUnique({ where: { id } })),
      one(ids.podId, (id) => this.prisma.port.findUnique({ where: { id } })),
      docIds.length
        ? this.prisma.documentRequirement.findMany({
            where: { id: { in: docIds } },
          })
        : Promise.resolve([]),
    ]);

    const bad = (
      field: string,
      message: string,
      code: ImportFieldError['code'] = 'INVALID_MASTER_REFERENCE',
    ) => errors.push({ field, code, message });
    const check = (
      field: string,
      id: string | null | undefined,
      row: { status: string; deletedAt: Date | null } | null,
      label: string,
      code?: ImportFieldError['code'],
    ) => {
      if (!id) return;
      if (!row || row.deletedAt || row.status !== ACTIVE) {
        bad(
          field,
          `Selected ${label} is not available. Choose an active ${label}.`,
          code,
        );
      }
    };

    check('categoryId', ids.categoryId, category, 'product');
    if (category && !category.isActive)
      bad('categoryId', 'Selected product is not available.');
    check('gradeId', ids.gradeId, grade, 'grade');
    if (grade && ids.categoryId && grade.categoryId !== ids.categoryId) {
      bad('gradeId', 'The grade does not belong to the selected product.');
    }
    check('brandId', ids.brandId, brand, 'brand / manufacturer');
    check('originCountryId', ids.originCountryId, origin, 'country of origin');
    if (origin && origin.type !== LocationType.COUNTRY) {
      bad('originCountryId', 'Country of origin must be a country.');
    }
    check('packagingId', ids.packagingId, packaging, 'packaging');
    check(
      'currencyId',
      ids.currencyId,
      currency,
      'currency',
      'INVALID_CURRENCY',
    );
    if (currency && !currency.importEnabled) {
      bad(
        'currencyId',
        `${currency.code} is not enabled for Import trading.`,
        'INVALID_CURRENCY',
      );
    }
    check(
      'incotermId',
      ids.incotermId,
      incoterm,
      'Incoterm',
      'INVALID_INCOTERM',
    );
    check(
      'priceBasisPortId',
      ids.priceBasisPortId,
      basisPort,
      'price basis port',
      'INVALID_PORT',
    );
    check(
      'paymentTermId',
      ids.paymentTermId,
      term,
      'payment term',
      'INVALID_PAYMENT_TERM',
    );
    if (term && !term.importEnabled) {
      bad(
        'paymentTermId',
        'This payment term is not offered for Import trading.',
        'INVALID_PAYMENT_TERM',
      );
    }
    check('polId', ids.polId, pol, 'port of loading', 'INVALID_PORT');
    check('podId', ids.podId, pod, 'port of discharge', 'INVALID_PORT');
    if (ids.polId && ids.podId && ids.polId === ids.podId) {
      bad(
        'podId',
        'Port of discharge must differ from port of loading.',
        'INVALID_PORT',
      );
    }
    const foundDocs = new Set(
      docs.filter((d) => d.status === ACTIVE && !d.deletedAt).map((d) => d.id),
    );
    for (const id of docIds) {
      if (!foundDocs.has(id))
        bad(
          'documentRequirementIds',
          'One of the selected documents is not available.',
        );
    }

    const named = <T extends { id: string; code: string; name: string }>(
      row: T | null,
    ) => (row ? { id: row.id, code: row.code, name: row.name } : null);

    return {
      currencyCode: currency?.code ?? null,
      paymentTermCurrencyCodes: term ? term.currencyCodes : null,
      errors,
      snapshot: {
        capturedAt: new Date().toISOString(),
        category: category
          ? {
              id: category.id,
              code: category.code,
              name: category.displayName ?? category.name,
            }
          : null,
        grade: grade
          ? {
              id: grade.id,
              code: grade.code,
              name: grade.displayName ?? grade.name,
              categoryId: grade.categoryId,
            }
          : null,
        customGradeName,
        brand: named(brand),
        originCountry: named(origin),
        packaging: named(packaging),
        currency: currency
          ? {
              ...named(currency)!,
              symbol: currency.symbol,
              decimalPlaces: currency.decimalPlaces,
            }
          : null,
        incoterm: incoterm
          ? { ...named(incoterm)!, priceBasis: incoterm.priceBasis }
          : null,
        priceBasisPort: basisPort
          ? { ...named(basisPort)!, countryCode: basisPort.countryCode }
          : null,
        paymentTerm: term
          ? {
              id: term.id,
              code: term.code,
              name: term.displayName ?? term.name,
              method: term.method,
              currencyCodes: term.currencyCodes,
            }
          : null,
        pol: pol ? { ...named(pol)!, countryCode: pol.countryCode } : null,
        pod: pod ? { ...named(pod)!, countryCode: pod.countryCode } : null,
        documentRequirements: docs.map((d) => ({
          ...named(d)!,
          documentCategory: d.documentCategory,
        })),
      },
    };
  }
}
