#!/usr/bin/env node
/**
 * Seeds marketplace listings onto a running backend via the Seller API
 * (useful when you cannot reach managed Postgres directly).
 *
 * Usage:
 *   node scripts/sync-catalog-to-remote-api.mjs
 *   API_BASE_URL=https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1 node scripts/sync-catalog-to-remote-api.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API_BASE =
  process.env.API_BASE_URL ??
  'https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1';
const PHONE = process.env.DEMO_PHONE ?? '+918240890242';
const OTP = process.env.DEMO_OTP ?? '123456';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} → ${res.status}: ${json.message ?? text.slice(0, 200)}`,
    );
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function login() {
  try {
    await api('/auth/otp/send', {
      method: 'POST',
      body: { phone: PHONE, purpose: 'LOGIN' },
    });
  } catch (e) {
    // Rate limit is fine if a prior OTP is still valid.
    if (e.status !== 429) throw e;
  }
  const verified = await api('/auth/otp/verify', {
    method: 'POST',
    body: { phone: PHONE, otp: OTP, purpose: 'LOGIN' },
  });
  const access = verified.data?.accessToken;
  if (!access) throw new Error('No access token from OTP verify');
  return access;
}

async function fetchAllGrades(token) {
  const byCode = new Map();
  let page = 1;
  let totalPages = 1;
  do {
    const payload = await api(
      `/master-data/grades/seller?page=${page}&limit=100`,
      { token },
    );
    for (const grade of payload.data ?? []) {
      byCode.set(String(grade.code).toUpperCase(), grade);
    }
    totalPages = payload.meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return byCode;
}

async function fetchAllSellerProducts(token) {
  const products = [];
  let page = 1;
  let totalPages = 1;
  do {
    const payload = await api(`/seller/products?page=${page}&limit=100`, {
      token,
    });
    products.push(...(payload.data ?? []));
    totalPages = payload.meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return products;
}

function loadCatalog() {
  const path = join(ROOT, 'prisma/seed-data/catalog-products.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildDefaultTiers(sellingPrice, moq) {
  const safeMoq = Math.max(1, Number(moq) || 1);
  const price = Number(sellingPrice) || 90000;
  const tier1Max = Math.max(safeMoq, 24);
  const tier2Min = tier1Max + 1;
  return [
    { minQty: safeMoq, maxQty: tier1Max, price },
    {
      minQty: tier2Min,
      maxQty: Math.max(tier2Min, 99),
      price: Math.round(price * 0.987),
    },
    {
      minQty: Math.max(tier2Min + 1, 100),
      maxQty: null,
      price: Math.round(price * 0.972),
    },
  ];
}

function listingFieldsFromProduct(product, catalogByCode) {
  const code = String(product.code || '').toUpperCase();
  const catalog = catalogByCode.get(code);
  const offer = product.offers?.[0] ?? {};
  const inventory = product.inventory?.[0] ?? {};
  const specs =
    product.technicalSpecs && typeof product.technicalSpecs === 'object'
      ? product.technicalSpecs
      : {};
  const sellingPrice = Number(
    offer.basePrice ?? catalog?.pricePerMt ?? product.basePrice ?? 90000,
  );
  const moq = Math.max(1, Number(offer.moq ?? catalog?.moq ?? 1));
  const stock = Number(
    inventory.availableQty ?? offer.quantity ?? catalog?.availableQty ?? 100,
  );
  const warehouseName =
    inventory.warehouse?.name ||
    specs.warehouseLabel ||
    catalog?.warehouseLabel ||
    'Mumbai Primary Warehouse';

  return {
    gradeId: product.gradeId ?? product.grade?.id,
    code: product.code,
    name: product.name,
    manufacturer: product.manufacturer ?? product.brand ?? 'PRIVATE',
    brand: product.brand ?? product.manufacturer ?? 'PRIVATE',
    mfi: product.mfi ?? catalog?.technicalSpecs?.mfi,
    density: product.density ?? catalog?.technicalSpecs?.density,
    packaging: product.packaging ?? '25kg bags',
    unit: product.unit || 'MT',
    countryOfOrigin: product.countryOfOrigin ?? catalog?.origin ?? 'IN',
    supplyOrigin: product.supplyOrigin ?? catalog?.supplyOrigin ?? 'domestic',
    application:
      specs.application ||
      (Array.isArray(specs.applications) ? specs.applications[0] : undefined) ||
      catalog?.applications?.[0],
    polymerType: specs.polymerType || catalog?.materialType,
    warehouseName,
    availableStock: stock,
    reservedStock: Number(inventory.reservedQty ?? 0),
    moq,
    sellingPrice,
    priceTiers: buildDefaultTiers(sellingPrice, moq),
    publishToMarketplace: true,
    metadata: { gstPercent: 18, catalogSynced: true, tiersBackfilled: true },
  };
}

async function main() {
  console.log(`API: ${API_BASE}`);
  const token = await login();
  console.log('Authenticated as demo seller/customer');

  const grades = await fetchAllGrades(token);
  console.log(`Seller-visible grades: ${grades.size}`);

  const existingProducts = await fetchAllSellerProducts(token);
  const existingByCode = new Map(
    existingProducts.map((p) => [String(p.code).toUpperCase(), p]),
  );
  console.log(`Existing seller products: ${existingByCode.size}`);

  const catalog = loadCatalog();
  const items = catalog.products ?? [];
  const catalogByCode = new Map(
    items
      .filter((i) => i.productCode)
      .map((i) => [String(i.productCode).toUpperCase(), i]),
  );
  let created = 0;
  let backfilled = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const code = String(item.productCode || '').toUpperCase();
    if (!code) {
      skipped += 1;
      continue;
    }
    if (
      existingByCode.has(code) ||
      code === 'HDPE_FILM' ||
      code === 'DEMO-HDPE-FILM'
    ) {
      skipped += 1;
      continue;
    }

    const grade =
      grades.get(String(item.gradeMasterCode || '').toUpperCase()) ??
      grades.get(String(item.grade || '').toUpperCase());
    if (!grade) {
      console.warn(
        `SKIP unmatched grade for ${code} (${item.gradeMasterCode})`,
      );
      skipped += 1;
      continue;
    }

    const warehouseName =
      item.warehouseLabel ||
      item.technicalSpecs?.warehouseLabel ||
      'Mumbai Primary Warehouse';

    const sellingPrice = Number(item.pricePerMt ?? 90000);
    const moq = Math.max(1, Number(item.moq ?? 1));
    const priceTiers = buildDefaultTiers(sellingPrice, moq);
    try {
      await api('/seller/products/listings', {
        method: 'POST',
        token,
        body: {
          gradeId: grade.id,
          code: item.productCode,
          name: item.name,
          brand: 'PRIVATE',
          description: item.description ?? undefined,
          technicalSpecs: {
            ...(item.technicalSpecs ?? {}),
            sourceId: item.sourceId,
            applications: item.applications,
            materialType: item.materialType,
            warehouseLabel: warehouseName,
          },
          mfi: item.technicalSpecs?.mfi,
          density: item.technicalSpecs?.density,
          packaging: '25kg bags',
          unit: item.unit || 'MT',
          countryOfOrigin: item.origin || 'IN',
          supplyOrigin: item.supplyOrigin ?? 'domestic',
          application: item.applications?.[0],
          polymerType: item.materialType,
          warehouseName,
          availableStock: Number(item.availableQty ?? 100),
          moq,
          sellingPrice,
          priceTiers,
          publishToMarketplace: true,
          metadata: { gstPercent: 18, catalogSynced: true },
        },
      });
      created += 1;
      existingByCode.set(code, { code });
      process.stdout.write(`+ ${code}\n`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL ${code}: ${e.message}`);
    }
  }

  // Backfill bulk tiers on existing ACTIVE listings that have none.
  for (const product of existingProducts) {
    const offer = product.offers?.[0];
    const tiers = offer?.priceTiers ?? [];
    if (!offer || tiers.length > 0) continue;
    if (!product.gradeId && !product.grade?.id) {
      console.warn(`SKIP backfill ${product.code}: missing gradeId`);
      continue;
    }
    try {
      await api(`/seller/products/listings/${product.id}`, {
        method: 'PATCH',
        token,
        body: listingFieldsFromProduct(product, catalogByCode),
      });
      backfilled += 1;
      process.stdout.write(`~ tiers ${product.code}\n`);
    } catch (e) {
      failed += 1;
      console.error(`FAIL backfill ${product.code}: ${e.message}`);
    }
  }

  const customerCheck = await api(
    '/customer/products?page=1&limit=5&sortBy=createdAt&sortOrder=desc',
    { token },
  );
  const sample = (customerCheck.data ?? []).map((p) => ({
    code: p.code,
    price: p.listing?.price ?? null,
    tiers: (p.listing?.priceTiers ?? []).length,
  }));
  console.log(
    JSON.stringify(
      {
        created,
        backfilled,
        skipped,
        failed,
        customerCatalogTotal: customerCheck.meta?.total ?? null,
        sample,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
