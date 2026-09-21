import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE = join(
  __dirname,
  '../../Swaroop-Customer-WEBAPP/mock/blind-grades.ts',
);

function extractObjectLiterals(src, fnName) {
  const items = [];
  const needle = `${fnName}({`;
  let idx = 0;
  while (idx < src.length) {
    const start = src.indexOf(needle, idx);
    if (start < 0) break;
    const open = src.indexOf('{', start);
    if (open < 0) break;
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          items.push(src.slice(open, i + 1));
          idx = i + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }
  return items;
}

function parseTsObject(literal) {
  return Function(`"use strict"; return (${literal});`)();
}

function mapGradeMaster(sku) {
  const material = (sku.materialType ?? '').toLowerCase();
  const sub = (sku.subCategory ?? '').toLowerCase();
  const grade = String(sku.grade ?? '').toUpperCase();
  const id = String(sku.id ?? '').toLowerCase();
  if (id.includes('nylon66')) return 'PA66_GF30_FR_BK';
  if (id.includes('compound-abs')) return 'COMPOUND_ABS_FR';
  if (id.includes('compound-pp')) return 'COMPOUND_PP_TALC';

  if (material.includes('rpet') || grade === 'RPET') return 'R_PET';
  if (material.includes('rhdpe') || grade === 'RHDPE') return 'R_HDPE';
  if (material.includes('rldpe') || grade === 'RLDPE') return 'R_LDPE';
  if (material.includes('rpp') || grade === 'RPP') return 'R_PP';
  if (material.includes('rabs') || grade === 'RABS') return 'R_ABS';

  if (material.includes('caustic')) return 'CAUSTIC';
  if (material.includes('melamine')) return 'MELAMINE';
  if (material.includes('maleic')) return 'MALEIC_ANHYDRIDE';
  if (material.includes('styrene')) return 'STYRENE';
  if (material.includes('mma')) return 'MMA';
  if (material.includes('benzene')) return 'BENZENE';
  if (material.includes('xylene')) return 'ORTHO_XYLENE';
  if (material.includes('ethyl acetate')) return 'ETHYL_ACETATE';
  if (material.includes('acetone')) return 'ACETONE';
  if (material.includes('ipa') || material.includes('isopropyl')) return 'IPA';
  if (material.includes('mibk')) return 'MIBK';
  if (material.includes('mek')) return 'MEK';
  if (material.includes('toluene')) return 'TOLUENE';
  if (material.includes('butanol')) return 'IBA';
  if (material.includes('meg') || material.includes('glycol')) return 'GLYCOL';
  if (material.includes('dop') || material.includes('dotp') || material.includes('plasticizer'))
    return 'PLASTICIZER';
  if (material.includes('stabilizer')) return 'STABILIZER';
  if (material.includes('base oil') || sku.categoryId === 'base-oils') return 'BASE_OIL';
  if (material.includes('masterbatch')) return 'MASTERBATCH_BLACK';
  if (material.includes('compound') && material.includes('abs')) return 'COMPOUND_ABS_FR';
  if (material.includes('compound')) return 'COMPOUND_PP_TALC';
  if (material.includes('pe wax')) return 'PE_WAX';
  if (material.includes('tpu')) return 'TPU_ELASTOMER';
  if (material.includes('pom')) return 'POM_COPOLYMER';
  if (material.includes('polycarbonate') || grade === 'PC') return 'PC_INJECTION';
  if (material.includes('nylon 66') || material.includes('nylon66')) return 'PA66_GF30_FR_BK';
  if (material.includes('nylon')) return 'NYLON_PA6';
  if (material.includes('eva')) return 'EVA_FILM';
  if (material.includes('hips')) return 'HIPS_INJECTION';
  if (material.includes('cpvc')) return 'CPVC';
  if (material.includes('abs') && !material.startsWith('r')) return 'ABS_INJECTION';
  if (material.includes('metallocene') || id.includes('metallocene')) return 'METALLOCENE';

  if (grade === 'PET' || material.includes('pet')) {
    return sub.includes('fiber') || sub.includes('fibre') ? 'PET_SHEET' : 'PET_BOTTLE';
  }
  if (grade === 'PVC' || material.includes('pvc')) {
    return sub.includes('paste') ? 'RPVC' : 'PVC_PIPE';
  }
  if (grade === 'PP' || material.includes('polypropylene')) {
    if (sub.includes('raffia')) return 'PP_RAFFIA';
    if (sub.includes('bopp') || sub.includes('film') || sub.includes('thermo')) return 'PP_FILM';
    if (sub.includes('copolymer') || sub.includes('impact')) return 'PP_CP';
    if (sub.includes('injection')) return 'PP_INJECTION';
    return 'PP_INJECTION';
  }
  if (grade === 'HDPE' || material.includes('hdpe')) {
    if (sub.includes('pipe')) return 'HDPE_PIPE';
    if (sub.includes('blow')) return 'HDPE_BLOW';
    if (sub.includes('injection') || sub.includes('mould')) return 'HDPE_MOULD';
    return 'HDPE_FILM';
  }
  if (grade === 'LLDPE' || material.includes('lldpe')) {
    return sub.includes('roto') ? 'LLDPE_ROTO' : 'LLDPE_FILM';
  }
  if (grade === 'LDPE' || material.includes('ldpe')) {
    return sub.includes('injection') ? 'LDPE_INJECTION' : 'LDPE_FILM';
  }

  if (sku.categoryId === 'base-oils') return 'BASE_OIL';
  return grade || 'PP_INJECTION';
}

const src = readFileSync(SOURCE, 'utf8');
const literals = extractObjectLiterals(src, 'blindGrade');
const products = literals.map((literal) => {
  const sku = parseTsObject(literal);
  return {
    sourceId: sku.id,
    name: sku.name,
    grade: sku.grade,
    productCode: sku.gradeCode,
    gradeMasterCode: mapGradeMaster(sku),
    parentCategoryId: sku.categoryId,
    materialType: sku.materialType,
    subCategory: sku.subCategory,
    description: sku.description,
    pricePerMt: sku.price,
    currency: 'INR',
    unit: 'MT',
    origin: sku.origin,
    warehouseLabel: sku.warehouseLabel,
    warehouseId: sku.warehouseId,
    availableQty: sku.stock,
    moq: sku.moq,
    eta: sku.eta,
    badge: sku.badge,
    casNumber: sku.casNumber,
    applications: sku.applications ?? [],
    creditEligible: Boolean(sku.creditEligible),
    stockStatus: sku.stockStatus,
    createdAt: sku.createdAt,
    popularityScore: sku.popularityScore ?? 0,
    supplyOrigin: sku.supplyOrigin ?? 'domestic',
    technicalSpecs: sku.technicalSpecs ?? {},
  };
});

const outPath = join(__dirname, '../prisma/seed-data/catalog-products.json');
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      source: 'Swaroop-Customer-WEBAPP/mock/blind-grades.ts',
      extractedAt: new Date().toISOString(),
      count: products.length,
      products,
    },
    null,
    2,
  )}\n`,
);

const unmapped = products.filter((p) => !p.gradeMasterCode);
console.log(`Extracted ${products.length} catalog products → ${outPath}`);
if (unmapped.length) {
  console.warn('Unmapped products:', unmapped.map((p) => p.sourceId));
}
const byGrade = {};
for (const p of products) {
  byGrade[p.gradeMasterCode] = (byGrade[p.gradeMasterCode] ?? 0) + 1;
}
console.log('Grade mapping counts:', byGrade);
