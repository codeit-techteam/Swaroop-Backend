import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type DocumentCategory,
  type IncotermPriceBasis,
  LocationType,
  MasterStatus,
  type PaymentTermMethod,
  type PaymentTermType,
  type PortType,
} from '../../../generated/prisma/client.js';
import type { AppConfig } from '../../../config/configuration.js';
import { PrismaService } from '../../../database/prisma.service.js';

/** Shipped in the runtime image (Dockerfile copies prisma/). */
const MASTER_DATA_FILE = join(
  process.cwd(),
  'prisma/seed-data/import-master-data.json',
);

type ImportMasterData = {
  currencies: Array<{
    code: string;
    name: string;
    symbol: string;
    decimalPlaces: number;
    importEnabled: boolean;
    sortOrder: number;
  }>;
  incoterms: Array<{
    code: string;
    name: string;
    priceBasis: IncotermPriceBasis;
    sortOrder: number;
    description: string;
  }>;
  countries: Array<{ code: string; name: string }>;
  ports: Array<{
    code: string;
    name: string;
    countryCode: string;
    type: PortType;
  }>;
  brands: Array<{ code: string; name: string; countryCode: string }>;
  packaging: Array<{ code: string; name: string; sortOrder: number }>;
  documentRequirements: Array<{
    code: string;
    name: string;
    documentCategory: DocumentCategory;
    sortOrder: number;
  }>;
  paymentTerms: Array<{
    code: string;
    name: string;
    method: PaymentTermMethod;
    paymentType: PaymentTermType;
    percentage?: number;
    days: number;
    currencyCodes: string[];
    sortOrder: number;
  }>;
};

/**
 * Inserts Import reference data (currencies, Incoterms, countries, UN/LOCODE
 * ports, brands, packaging, document types, payment terms) that is missing
 * from the database. Insert-only: existing rows, including anything an Admin
 * renamed or disabled, are never modified. Safe with concurrent instances
 * (skipDuplicates on unique codes).
 */
export async function insertMissingImportMasterData(
  prisma: PrismaService,
  data: ImportMasterData,
): Promise<Record<string, number>> {
  const active = MasterStatus.ACTIVE;

  const currencies = await prisma.currency.createMany({
    data: data.currencies.map((c) => ({ ...c, status: active })),
    skipDuplicates: true,
  });

  const incoterms = await prisma.incoterm.createMany({
    data: data.incoterms.map((i) => ({ ...i, status: active })),
    skipDuplicates: true,
  });

  const countries = await prisma.location.createMany({
    data: data.countries.map((c) => ({
      code: c.code,
      name: c.name,
      type: LocationType.COUNTRY,
      countryCode: c.code,
      status: active,
    })),
    skipDuplicates: true,
  });

  const countryRows = await prisma.location.findMany({
    where: { code: { in: data.countries.map((c) => c.code) } },
    select: { id: true, code: true },
  });
  const countryIds = new Map(countryRows.map((r) => [r.code, r.id]));

  const ports = await prisma.port.createMany({
    data: data.ports.map((p) => ({
      ...p,
      countryId: countryIds.get(p.countryCode),
      status: active,
    })),
    skipDuplicates: true,
  });

  const brands = await prisma.brand.createMany({
    data: data.brands.map((b) => ({
      code: b.code,
      name: b.name,
      countryId: countryIds.get(b.countryCode),
      status: active,
    })),
    skipDuplicates: true,
  });

  const packaging = await prisma.packaging.createMany({
    data: data.packaging.map((p) => ({ ...p, status: active })),
    skipDuplicates: true,
  });

  const documentRequirements = await prisma.documentRequirement.createMany({
    data: data.documentRequirements.map((d) => ({ ...d, status: active })),
    skipDuplicates: true,
  });

  const paymentTerms = await prisma.paymentTerm.createMany({
    data: data.paymentTerms.map((t) => ({
      code: t.code,
      name: t.name,
      displayName: t.name,
      method: t.method,
      paymentType: t.paymentType,
      percentage: t.percentage,
      days: t.days,
      currencyCodes: t.currencyCodes,
      importEnabled: true,
      status: active,
      sortOrder: t.sortOrder,
    })),
    skipDuplicates: true,
  });

  return {
    currencies: currencies.count,
    incoterms: incoterms.count,
    countries: countries.count,
    ports: ports.count,
    brands: brands.count,
    packaging: packaging.count,
    documentRequirements: documentRequirements.count,
    paymentTerms: paymentTerms.count,
  };
}

/**
 * Fills missing Import master data on every deploy so a fresh or partially
 * seeded database still offers currencies, ports, Incoterms and payment terms.
 * Disable with IMPORT_MASTER_DATA_AUTO_SEED=false.
 */
@Injectable()
export class ImportMasterDataBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportMasterDataBootstrap.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get<AppConfig['app']>('app')?.env === 'test') return;
    if (this.config.get<boolean>('import.enabled') === false) return;
    if (this.config.get<boolean>('import.autoSeedMasterData') === false) return;

    try {
      const data = JSON.parse(
        readFileSync(MASTER_DATA_FILE, 'utf8'),
      ) as ImportMasterData;
      const inserted = await insertMissingImportMasterData(this.prisma, data);
      const total = Object.values(inserted).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        this.logger.log(
          `Inserted missing Import master data ${JSON.stringify(inserted)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Import master data bootstrap failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
