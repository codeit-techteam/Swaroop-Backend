import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  MasterStatus,
  PrismaClient,
  ProductStatus,
} from '../src/generated/prisma/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

type CatalogProduct = {
  sourceId: string;
  name: string;
  grade: string;
  productCode: string;
  gradeMasterCode: string;
  parentCategoryId: string;
  materialType: string;
  subCategory?: string;
  description?: string;
  pricePerMt: number;
  currency: string;
  unit: string;
  origin?: string;
  warehouseLabel?: string;
  warehouseId?: string;
  availableQty: number;
  moq: number;
  eta?: string;
  badge?: string;
  casNumber?: string;
  applications: string[];
  creditEligible: boolean;
  stockStatus?: string;
  createdAt?: string;
  popularityScore?: number;
  supplyOrigin?: string;
  technicalSpecs?: Record<string, string>;
};

type CatalogFile = {
  source: string;
  count: number;
  products: CatalogProduct[];
};

type Counter = {
  existing: number;
  inserted: number;
  updated: number;
  skipped: number;
  duplicate: number;
  conflict: number;
  unmatched: number;
};

function emptyCounter(): Counter {
  return {
    existing: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    duplicate: 0,
    conflict: 0,
    unmatched: 0,
  };
}

function createPrisma() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public',
  });
  return new PrismaClient({ adapter });
}

function loadCatalog(): CatalogFile {
  const path = join(ROOT, 'prisma/seed-data/catalog-products.json');
  return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
}

function offerReference(productCode: string) {
  return `OFFER-CAT-${productCode.replace(/[^A-Z0-9]+/gi, '-').toUpperCase()}`;
}

function specsPayload(item: CatalogProduct) {
  return {
    ...(item.technicalSpecs ?? {}),
    sourceId: item.sourceId,
    parentCategoryId: item.parentCategoryId,
    materialType: item.materialType,
    subCategory: item.subCategory,
    casNumber: item.casNumber,
    applications: item.applications,
    badge: item.badge,
    eta: item.eta,
    warehouseLabel: item.warehouseLabel,
    warehouseId: item.warehouseId,
    creditEligible: item.creditEligible,
    popularityScore: item.popularityScore ?? 0,
    stockStatus: item.stockStatus,
    origin: item.origin,
  };
}

export async function runCatalogImport(prisma: PrismaClient) {
  const catalog = loadCatalog();
  const report = {
    generatedAt: new Date().toISOString(),
    source: catalog.source,
    categories: emptyCounter(),
    grades: emptyCounter(),
    products: emptyCounter(),
    attributes: emptyCounter(),
    listings: emptyCounter(),
    conflicts: [] as Array<Record<string, string>>,
    unmatched: [] as Array<Record<string, string>>,
  };

  const extraAttributes = [
    { code: 'FORM', name: 'Form', dataType: 'TEXT' as const },
    { code: 'ORIGIN', name: 'Origin', dataType: 'TEXT' as const },
    { code: 'APPLICATION', name: 'Application', dataType: 'TEXT' as const },
    { code: 'BRAND', name: 'Brand', dataType: 'TEXT' as const },
    { code: 'SPECIFICATION', name: 'Specification', dataType: 'TEXT' as const },
  ];

  report.attributes.existing = await prisma.productAttribute.count({
    where: { deletedAt: null },
  });
  for (const [index, attribute] of extraAttributes.entries()) {
    const found = await prisma.productAttribute.findUnique({
      where: { code: attribute.code },
    });
    await prisma.productAttribute.upsert({
      where: { code: attribute.code },
      update: {
        name: attribute.name,
        displayName: attribute.name,
        status: MasterStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        code: attribute.code,
        name: attribute.name,
        displayName: attribute.name,
        dataType: attribute.dataType,
        status: MasterStatus.ACTIVE,
        sortOrder: 100 + index,
      },
    });
    if (found) report.attributes.updated += 1;
    else report.attributes.inserted += 1;
  }

  report.categories.existing = await prisma.gradeCategory.count({
    where: { deletedAt: null },
  });
  report.grades.existing = await prisma.grade.count({ where: { deletedAt: null } });

  const sellerUser = await prisma.user.findUnique({
    where: { email: 'seller@test.local' },
  });
  const sellerProfile = sellerUser
    ? await prisma.sellerProfile.findUnique({ where: { userId: sellerUser.id } })
    : null;
  const warehouse = await prisma.warehouse.findUnique({
    where: { code: 'WH-MUM-HUB' },
  });

  if (!sellerProfile || !warehouse || !sellerUser) {
    throw new Error(
      'Catalog import requires seeded demo seller (seller@test.local) and warehouse WH-MUM-HUB. Run npm run prisma:seed first.',
    );
  }

  const existingProducts = await prisma.product.findMany({
    where: { organizationId: sellerProfile.organizationId, deletedAt: null },
    select: { id: true, code: true, name: true, technicalSpecs: true },
  });
  report.products.existing = existingProducts.length;
  const productByCode = new Map(existingProducts.map((p) => [p.code, p]));

  const seenCodes = new Set<string>();

  for (const item of catalog.products) {
    if (seenCodes.has(item.productCode)) {
      report.products.duplicate += 1;
      report.conflicts.push({
        type: 'duplicate',
        productCode: item.productCode,
        sourceId: item.sourceId,
        message: 'Duplicate productCode in frontend catalog extract',
      });
      continue;
    }
    seenCodes.add(item.productCode);

    const grade = await prisma.grade.findFirst({
      where: { code: item.gradeMasterCode, deletedAt: null },
    });
    if (!grade) {
      report.products.unmatched += 1;
      report.unmatched.push({
        sourceId: item.sourceId,
        productCode: item.productCode,
        gradeMasterCode: item.gradeMasterCode,
        message: 'Grade master code not found — skipped',
      });
      continue;
    }

    const existing = productByCode.get(item.productCode);
    const existingSourceId =
      existing &&
      typeof existing.technicalSpecs === 'object' &&
      existing.technicalSpecs &&
      'sourceId' in existing.technicalSpecs
        ? String((existing.technicalSpecs as { sourceId?: string }).sourceId ?? '')
        : '';

    if (existing && existingSourceId && existingSourceId !== item.sourceId) {
      report.products.conflict += 1;
      report.conflicts.push({
        type: 'conflict',
        productCode: item.productCode,
        existingName: existing.name,
        incomingName: item.name,
        existingSourceId,
        incomingSourceId: item.sourceId,
        message: 'Same product code, different source ids — skipped overwrite',
      });
      continue;
    }

    if (item.productCode === 'DEMO-HDPE-FILM') {
      report.products.skipped += 1;
      report.conflicts.push({
        type: 'conflict',
        productCode: item.productCode,
        message: 'Protected demo product — skipped',
      });
      continue;
    }

    const demoMatch = existingProducts.find(
      (p) =>
        p.code === 'DEMO-HDPE-FILM' &&
        item.gradeMasterCode === 'HDPE_FILM' &&
        /hdpe film/i.test(item.name),
    );
    if (demoMatch) {
      report.conflicts.push({
        type: 'reconciliation',
        existingCode: 'DEMO-HDPE-FILM',
        incomingCode: item.productCode,
        incomingName: item.name,
        message:
          'Possible match with existing DEMO-HDPE-FILM. Imported as a separate catalog SKU; demo row was not overwritten.',
      });
    }

    const product = await prisma.product.upsert({
      where: {
        organizationId_code: {
          organizationId: sellerProfile.organizationId,
          code: item.productCode,
        },
      },
      update: {
        name: item.name,
        gradeId: grade.id,
        brand: 'PRIVATE',
        description: item.description,
        technicalSpecs: specsPayload(item),
        mfi: item.technicalSpecs?.mfi ?? null,
        density: item.technicalSpecs?.density ?? null,
        packaging: '25kg bags',
        unit: item.unit || 'MT',
        countryOfOrigin: 'IN',
        supplyOrigin: item.supplyOrigin ?? 'domestic',
        status: ProductStatus.ACTIVE,
        sellerProfileId: sellerProfile.id,
        deletedAt: null,
      },
      create: {
        organizationId: sellerProfile.organizationId,
        sellerProfileId: sellerProfile.id,
        gradeId: grade.id,
        code: item.productCode,
        name: item.name,
        brand: 'PRIVATE',
        description: item.description,
        technicalSpecs: specsPayload(item),
        mfi: item.technicalSpecs?.mfi ?? null,
        density: item.technicalSpecs?.density ?? null,
        packaging: '25kg bags',
        unit: item.unit || 'MT',
        countryOfOrigin: 'IN',
        supplyOrigin: item.supplyOrigin ?? 'domestic',
        status: ProductStatus.ACTIVE,
      },
    });

    if (existing) report.products.updated += 1;
    else {
      report.products.inserted += 1;
      productByCode.set(item.productCode, product);
    }

    await prisma.inventory.upsert({
      where: {
        productId_warehouseId: {
          productId: product.id,
          warehouseId: warehouse.id,
        },
      },
      update: {
        availableQty: item.availableQty,
        minStockQty: item.moq,
        status: 'AVAILABLE',
        sellerProfileId: sellerProfile.id,
        unit: item.unit || 'MT',
      },
      create: {
        organizationId: sellerProfile.organizationId,
        sellerProfileId: sellerProfile.id,
        productId: product.id,
        warehouseId: warehouse.id,
        availableQty: item.availableQty,
        minStockQty: item.moq,
        unit: item.unit || 'MT',
        status: 'AVAILABLE',
      },
    });

    const existingOffer = await prisma.offer.findUnique({
      where: { referenceNumber: offerReference(item.productCode) },
    });
    await prisma.offer.upsert({
      where: { referenceNumber: offerReference(item.productCode) },
      update: {
        status: 'ACTIVE',
        basePrice: item.pricePerMt,
        quantity: item.availableQty,
        moq: item.moq,
        unit: item.unit || 'MT',
        currency: 'INR',
        productId: product.id,
        gradeId: grade.id,
        warehouseId: warehouse.id,
        deliveryTerms: item.eta ?? null,
        visibility: 'MARKETPLACE',
        deletedAt: null,
      },
      create: {
        referenceNumber: offerReference(item.productCode),
        organizationId: sellerProfile.organizationId,
        sellerProfileId: sellerProfile.id,
        productId: product.id,
        gradeId: grade.id,
        warehouseId: warehouse.id,
        quantity: item.availableQty,
        moq: item.moq,
        unit: item.unit || 'MT',
        basePrice: item.pricePerMt,
        currency: 'INR',
        status: 'ACTIVE',
        visibility: 'MARKETPLACE',
        deliveryTerms: item.eta ?? null,
        createdById: sellerUser.id,
      },
    });
    if (existingOffer) report.listings.updated += 1;
    else report.listings.inserted += 1;
  }

  const counts = {
    categories: await prisma.gradeCategory.count({ where: { deletedAt: null } }),
    grades: await prisma.grade.count({ where: { deletedAt: null } }),
    products: await prisma.product.count({ where: { deletedAt: null } }),
    attributes: await prisma.productAttribute.count({
      where: { deletedAt: null },
    }),
    offers: await prisma.offer.count({ where: { deletedAt: null } }),
    orphanProducts: await prisma.product.count({
      where: { deletedAt: null, grade: { is: { deletedAt: { not: null } } } },
    }),
  };

  const summary = {
    ...report,
    database: counts,
  };

  const reportDir = join(ROOT, 'prisma/seed-data');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    join(reportDir, 'catalog-migration-report.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  return summary;
}

function printSummary(summary: Awaited<ReturnType<typeof runCatalogImport>>) {
  console.log('');
  console.log('====================================');
  console.log('SWAROOP CATALOG MIGRATION');
  console.log('====================================');
  console.log('');
  console.log('Categories:');
  console.log(`Existing: ${summary.categories.existing}`);
  console.log(`Inserted: ${summary.categories.inserted}`);
  console.log(`Updated: ${summary.categories.updated}`);
  console.log('');
  console.log('Grades:');
  console.log(`Existing: ${summary.grades.existing}`);
  console.log(`Inserted: ${summary.grades.inserted}`);
  console.log(`Updated: ${summary.grades.updated}`);
  console.log(`Duplicates: ${summary.grades.duplicate}`);
  console.log('');
  console.log('Products:');
  console.log(`Existing: ${summary.products.existing}`);
  console.log(`Inserted: ${summary.products.inserted}`);
  console.log(`Updated: ${summary.products.updated}`);
  console.log(`Skipped: ${summary.products.skipped}`);
  console.log(`Unmatched: ${summary.products.unmatched}`);
  console.log('');
  console.log('Attributes:');
  console.log(`Existing: ${summary.attributes.existing}`);
  console.log(`Inserted: ${summary.attributes.inserted}`);
  console.log(`Updated: ${summary.attributes.updated}`);
  console.log('');
  console.log('Seller Listings / Offers:');
  console.log(`Inserted: ${summary.listings.inserted}`);
  console.log(`Updated: ${summary.listings.updated}`);
  console.log('');
  console.log(`Conflicts: ${summary.conflicts.length}`);
  for (const conflict of summary.conflicts) {
    console.log(` - ${conflict.type}: ${conflict.message}`);
  }
  if (summary.unmatched.length) {
    console.log('');
    console.log('Unmatched:');
    for (const item of summary.unmatched) {
      console.log(` - ${item.sourceId} → ${item.gradeMasterCode}`);
    }
  }
  console.log('');
  console.log('Database totals:');
  console.log(`Categories: ${summary.database.categories}`);
  console.log(`Grades: ${summary.database.grades}`);
  console.log(`Products: ${summary.database.products}`);
  console.log(`Attributes: ${summary.database.attributes}`);
  console.log(`Offers: ${summary.database.offers}`);
  console.log('====================================');
}

async function main() {
  const prisma = createPrisma();
  try {
    const summary = await runCatalogImport(prisma);
    printSummary(summary);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirect = process.argv[1]?.includes('import-catalog');
if (isDirect) {
  main().catch((error) => {
    console.error('Catalog import failed', error);
    process.exitCode = 1;
  });
}
