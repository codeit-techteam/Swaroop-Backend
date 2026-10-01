import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DocumentCategory,
  IncotermPriceBasis,
  LocationType,
  MasterStatus,
  PaymentTermMethod,
  PaymentTermType,
  PortType,
  type PrismaClient,
} from '../../src/generated/prisma/client.js';
import { DEFAULT_MATCH_WEIGHTS } from '../../src/modules/import/domain/import.constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
 * Reference data for Import trading (currencies, Incoterms, UN/LOCODE ports,
 * manufacturers, packaging, document types, payment terms). Idempotent:
 * re-running only fills gaps and never re-activates records an Admin disabled.
 */
export async function seedImportMasterData(prisma: PrismaClient) {
  const data = JSON.parse(
    readFileSync(
      join(__dirname, '../seed-data/import-master-data.json'),
      'utf8',
    ),
  ) as ImportMasterData;

  for (const c of data.currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        symbol: c.symbol,
        decimalPlaces: c.decimalPlaces,
      },
      create: { ...c, status: MasterStatus.ACTIVE },
    });
  }

  for (const i of data.incoterms) {
    await prisma.incoterm.upsert({
      where: { code: i.code },
      update: {
        name: i.name,
        description: i.description,
        priceBasis: i.priceBasis,
      },
      create: { ...i, status: MasterStatus.ACTIVE },
    });
  }

  const countryIds = new Map<string, string>();
  for (const c of data.countries) {
    const row = await prisma.location.upsert({
      where: { code: c.code },
      update: { name: c.name, countryCode: c.code },
      create: {
        code: c.code,
        name: c.name,
        type: LocationType.COUNTRY,
        countryCode: c.code,
        status: MasterStatus.ACTIVE,
      },
    });
    countryIds.set(c.code, row.id);
  }

  for (const p of data.ports) {
    await prisma.port.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        countryCode: p.countryCode,
        countryId: countryIds.get(p.countryCode),
        type: p.type,
      },
      create: {
        ...p,
        countryId: countryIds.get(p.countryCode),
        status: MasterStatus.ACTIVE,
      },
    });
  }

  for (const b of data.brands) {
    await prisma.brand.upsert({
      where: { code: b.code },
      update: { name: b.name, countryId: countryIds.get(b.countryCode) },
      create: {
        code: b.code,
        name: b.name,
        countryId: countryIds.get(b.countryCode),
        status: MasterStatus.ACTIVE,
      },
    });
  }

  for (const p of data.packaging) {
    await prisma.packaging.upsert({
      where: { code: p.code },
      update: { name: p.name },
      create: { ...p, status: MasterStatus.ACTIVE },
    });
  }

  for (const d of data.documentRequirements) {
    await prisma.documentRequirement.upsert({
      where: { code: d.code },
      update: { name: d.name, documentCategory: d.documentCategory },
      create: { ...d, status: MasterStatus.ACTIVE },
    });
  }

  for (const t of data.paymentTerms) {
    await prisma.paymentTerm.upsert({
      where: { code: t.code },
      update: {
        name: t.name,
        displayName: t.name,
        method: t.method,
        currencyCodes: t.currencyCodes,
        importEnabled: true,
      },
      create: {
        code: t.code,
        name: t.name,
        displayName: t.name,
        method: t.method,
        paymentType: t.paymentType,
        percentage: t.percentage,
        days: t.days,
        currencyCodes: t.currencyCodes,
        importEnabled: true,
        status: MasterStatus.ACTIVE,
        sortOrder: t.sortOrder,
      },
    });
  }

  await prisma.importSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', matchWeights: DEFAULT_MATCH_WEIGHTS },
  });

  return {
    currencies: data.currencies.length,
    incoterms: data.incoterms.length,
    countries: data.countries.length,
    ports: data.ports.length,
    brands: data.brands.length,
    packaging: data.packaging.length,
    documentRequirements: data.documentRequirements.length,
    paymentTerms: data.paymentTerms.length,
  };
}
