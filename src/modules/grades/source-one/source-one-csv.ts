import { createHash } from 'node:crypto';
import { GradeParentGroup } from '../../../generated/prisma/client.js';

export const SOURCE_ONE = 'SOURCE_ONE';

/** Exact header row of the Source.One grade master export. */
export const SOURCE_ONE_HEADERS = [
  'Category',
  'Grade Group',
  'Grade No.',
  'Manufacturer',
  'Full Grade Name (if priced today)',
  "In Today's Delhi Price List",
  'Price Today (Rs/kg)',
  'Producer Price (Rs/kg)',
  'Producer Price Type',
] as const;

/** Prices are stored as NUMERIC(12,2); more decimals would be silently rounded. */
const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export type SourceOneRow = {
  line: number;
  category: string;
  gradeGroup: string;
  gradeNo: string;
  manufacturer: string | null;
  fullGradeName: string | null;
  inTodaysDelhiPriceList: boolean;
  priceTodayRsKg: string | null;
  producerPriceRsKg: string | null;
  producerPriceType: string | null;
};

export type SourceOneIssue = {
  line: number;
  field?: string;
  value?: string;
  message: string;
};

export type SourceOneDuplicate = {
  sourceKey: string;
  keptLine: number;
  mergedLines: number[];
  identical: boolean;
};

export type PlannedCategory = {
  code: string;
  name: string;
  parentGroup: GradeParentGroup;
};

export type PlannedGradeGroup = {
  categoryCode: string;
  code: string;
  name: string;
};

export type PlannedGrade = SourceOneRow & {
  sourceKey: string;
  code: string;
  categoryCode: string;
  gradeGroupCode: string;
  displayName: string;
  /** All CSV lines that resolved to this grade (more than one when merged). */
  lines: number[];
};

export type SourceOnePlan = {
  totalRows: number;
  validRows: number;
  invalid: SourceOneIssue[];
  warnings: SourceOneIssue[];
  duplicates: SourceOneDuplicate[];
  categories: PlannedCategory[];
  gradeGroups: PlannedGradeGroup[];
  grades: PlannedGrade[];
};

export class SourceOneCsvError extends Error {}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) throw new SourceOneCsvError('Unterminated quoted field in CSV');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable code for master tables: "PP CP" -> "PP_CP", "rLLDPE" -> "RLLDPE". */
export function masterCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function sourceKeyOf(row: {
  category: string;
  gradeGroup: string;
  gradeNo: string;
  manufacturer: string | null;
}): string {
  return [row.category, row.gradeGroup, row.gradeNo, row.manufacturer ?? '']
    .map((v) => v.trim().toUpperCase())
    .join('|');
}

/** Unique, deterministic Grade.code for a Source.One grade. */
export function gradeCodeOf(row: PlannedGrade | SourceOneRow): string {
  const part = (v: string) => masterCode(v).slice(0, 24) || 'NA';
  const hash = sha256(sourceKeyOf(row)).slice(0, 6).toUpperCase();
  return [
    'SO',
    part(row.category),
    part(row.gradeNo),
    part(row.manufacturer ?? 'NA'),
    hash,
  ].join('-');
}

/** Display label used when Source.One has no full grade name for the row. */
export function displayNameOf(row: {
  gradeGroup: string;
  gradeNo: string;
  manufacturer: string | null;
  fullGradeName: string | null;
}): string {
  if (row.fullGradeName) return row.fullGradeName;
  const base = `${row.gradeGroup} ${row.gradeNo}`;
  return row.manufacturer ? `${base} - ${row.manufacturer}` : base;
}

const PARENT_GROUP_BY_CATEGORY: Record<string, GradeParentGroup> = {
  COMPOUND: GradeParentGroup.COMPOUNDS,
  COMPOUNDED: GradeParentGroup.COMPOUNDS,
  COMPOUNDS: GradeParentGroup.COMPOUNDS,
  MASTERBATCH: GradeParentGroup.MASTERBATCH,
  ELASTOMER: GradeParentGroup.ELASTOMERS,
  PLASTOMER: GradeParentGroup.ELASTOMERS,
  THERMOPLASTIC: GradeParentGroup.ELASTOMERS,
  TPU: GradeParentGroup.ELASTOMERS,
  TPV: GradeParentGroup.ELASTOMERS,
  SOLVENTS: GradeParentGroup.SOLVENTS,
  ACETONE: GradeParentGroup.SOLVENTS,
  BUTYL_GLYCOL: GradeParentGroup.SOLVENTS,
  MIBK: GradeParentGroup.SOLVENTS,
  MIX_XYLENE: GradeParentGroup.SOLVENTS,
  NPA: GradeParentGroup.SOLVENTS,
  TOLUENE: GradeParentGroup.SOLVENTS,
  GLYCERINE: GradeParentGroup.CHEMICALS,
  ALKYL: GradeParentGroup.CHEMICALS,
  PLASTICIZERS: GradeParentGroup.CHEMICALS,
  HR_PIB: GradeParentGroup.CHEMICALS,
  TIO2: GradeParentGroup.CHEMICALS,
  MAH: GradeParentGroup.INTERMEDIATES,
  MDI: GradeParentGroup.INTERMEDIATES,
  POLYOL: GradeParentGroup.INTERMEDIATES,
  VAM: GradeParentGroup.INTERMEDIATES,
  PHENOL: GradeParentGroup.INTERMEDIATES,
  STYRENE: GradeParentGroup.INTERMEDIATES,
  BASE_OIL: GradeParentGroup.BASE_OILS,
  RECYCLE_BASE_OIL: GradeParentGroup.RECYCLED,
  R: GradeParentGroup.RECYCLED,
  RHDPE: GradeParentGroup.RECYCLED,
  RLLDPE: GradeParentGroup.RECYCLED,
  RPE100: GradeParentGroup.RECYCLED,
  RPVC: GradeParentGroup.RECYCLED,
  DISABLED: GradeParentGroup.SPECIALTY,
  SUBSCRIPTION: GradeParentGroup.SPECIALTY,
  GRINDING: GradeParentGroup.SPECIALTY,
  LBM: GradeParentGroup.SPECIALTY,
};

/**
 * Parent group for a category created by the import. Only used for categories
 * that do not exist yet; existing categories keep their Admin-assigned group.
 */
export function parentGroupOf(categoryCode: string): GradeParentGroup {
  return PARENT_GROUP_BY_CATEGORY[categoryCode] ?? GradeParentGroup.POLYMERS;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function filledFields(row: SourceOneRow): number {
  return [
    row.manufacturer,
    row.fullGradeName,
    row.priceTodayRsKg,
    row.producerPriceRsKg,
    row.producerPriceType,
  ].filter((v) => v != null).length;
}

/** Prefer the priced (Delhi list) row, then the most complete, then the first. */
function preferred(a: SourceOneRow, b: SourceOneRow): SourceOneRow {
  if (a.inTodaysDelhiPriceList !== b.inTodaysDelhiPriceList) {
    return a.inTodaysDelhiPriceList ? a : b;
  }
  const diff = filledFields(b) - filledFields(a);
  return diff > 0 ? b : a;
}

function sameValues(a: SourceOneRow, b: SourceOneRow): boolean {
  const { line: _a, ...ra } = a;
  const { line: _b, ...rb } = b;
  return JSON.stringify(ra) === JSON.stringify(rb);
}

/**
 * Validates a Source.One CSV and resolves it into categories, grade groups and
 * one grade per Category|Grade Group|Grade No.|Manufacturer (case-insensitive).
 * Throws SourceOneCsvError for file-level problems (wrong headers, empty file).
 */
export function planSourceOneImport(text: string): SourceOnePlan {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new SourceOneCsvError('CSV file is empty');

  const actual = header.map((h) => h.trim());
  const missing = SOURCE_ONE_HEADERS.filter((h) => !actual.includes(h));
  const unexpected = actual.filter(
    (h) => h && !(SOURCE_ONE_HEADERS as readonly string[]).includes(h),
  );
  if (missing.length || unexpected.length) {
    throw new SourceOneCsvError(
      [
        missing.length ? `Missing columns: ${missing.join(', ')}` : '',
        unexpected.length ? `Unexpected columns: ${unexpected.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. '),
    );
  }
  const col = Object.fromEntries(
    SOURCE_ONE_HEADERS.map((h) => [h, actual.indexOf(h)]),
  ) as Record<(typeof SOURCE_ONE_HEADERS)[number], number>;

  const invalid: SourceOneIssue[] = [];
  const warnings: SourceOneIssue[] = [];
  const valid: SourceOneRow[] = [];
  let totalRows = 0;

  rows.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => !c.trim())) return;
    totalRows++;
    const get = (h: (typeof SOURCE_ONE_HEADERS)[number]) => cells[col[h]];
    const issues: SourceOneIssue[] = [];

    if (cells.length !== header.length) {
      issues.push({
        line,
        message: `Expected ${header.length} columns, found ${cells.length}`,
      });
    }
    const category = blankToNull(get('Category'));
    const gradeGroup = blankToNull(get('Grade Group'));
    const gradeNo = blankToNull(get('Grade No.'));
    if (!category)
      issues.push({ line, field: 'Category', message: 'Missing Category' });
    if (!gradeGroup)
      issues.push({
        line,
        field: 'Grade Group',
        message: 'Missing Grade Group',
      });
    if (!gradeNo)
      issues.push({ line, field: 'Grade No.', message: 'Missing Grade No.' });

    const delhiRaw = blankToNull(get("In Today's Delhi Price List"));
    const delhi = delhiRaw?.toLowerCase();
    if (delhi !== 'yes' && delhi !== 'no') {
      issues.push({
        line,
        field: "In Today's Delhi Price List",
        value: delhiRaw ?? '',
        message: 'Expected Yes or No',
      });
    }

    const prices: Record<string, string | null> = {};
    for (const h of [
      'Price Today (Rs/kg)',
      'Producer Price (Rs/kg)',
    ] as const) {
      const value = blankToNull(get(h));
      if (value && !PRICE_PATTERN.test(value)) {
        issues.push({ line, field: h, value, message: 'Invalid price' });
      }
      prices[h] = value;
    }

    if (issues.length) {
      invalid.push(...issues);
      return;
    }

    const row: SourceOneRow = {
      line,
      category: category!,
      gradeGroup: gradeGroup!,
      gradeNo: gradeNo!,
      manufacturer: blankToNull(get('Manufacturer')),
      fullGradeName: blankToNull(get('Full Grade Name (if priced today)')),
      inTodaysDelhiPriceList: delhi === 'yes',
      priceTodayRsKg: prices['Price Today (Rs/kg)'],
      producerPriceRsKg: prices['Producer Price (Rs/kg)'],
      producerPriceType: blankToNull(get('Producer Price Type')),
    };
    if (!row.manufacturer) {
      warnings.push({
        line,
        field: 'Manufacturer',
        message: 'Manufacturer is blank (stored as NULL)',
      });
    }
    if (row.producerPriceType && !row.producerPriceRsKg) {
      warnings.push({
        line,
        field: 'Producer Price Type',
        message: 'Producer Price Type without Producer Price',
      });
    }
    valid.push(row);
  });

  if (!valid.length) {
    throw new SourceOneCsvError('CSV contains no valid grade rows');
  }

  const byKey = new Map<
    string,
    { kept: SourceOneRow; lines: number[]; identical: boolean }
  >();
  for (const row of valid) {
    const key = sourceKeyOf(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { kept: row, lines: [row.line], identical: true });
      continue;
    }
    existing.identical = existing.identical && sameValues(existing.kept, row);
    existing.kept = preferred(existing.kept, row);
    existing.lines.push(row.line);
  }

  const categories = new Map<string, PlannedCategory>();
  const gradeGroups = new Map<string, PlannedGradeGroup>();
  const duplicates: SourceOneDuplicate[] = [];
  const grades: PlannedGrade[] = [];

  for (const [sourceKey, { kept, lines, identical }] of byKey) {
    const categoryCode = masterCode(kept.category);
    const known = categories.get(categoryCode);
    if (known && known.name !== kept.category) {
      throw new SourceOneCsvError(
        `Categories "${known.name}" and "${kept.category}" resolve to the same code ${categoryCode}`,
      );
    }
    categories.set(categoryCode, {
      code: categoryCode,
      name: kept.category,
      parentGroup: parentGroupOf(categoryCode),
    });

    const gradeGroupCode = masterCode(kept.gradeGroup);
    gradeGroups.set(`${categoryCode}|${gradeGroupCode}`, {
      categoryCode,
      code: gradeGroupCode,
      name: kept.gradeGroup,
    });

    if (lines.length > 1) {
      duplicates.push({
        sourceKey,
        keptLine: kept.line,
        mergedLines: lines.filter((l) => l !== kept.line),
        identical,
      });
    }

    const planned: PlannedGrade = {
      ...kept,
      sourceKey,
      categoryCode,
      gradeGroupCode,
      displayName: displayNameOf(kept),
      lines,
      code: '',
    };
    planned.code = gradeCodeOf(planned);
    grades.push(planned);
  }

  const codes = new Set(grades.map((g) => g.code));
  if (codes.size !== grades.length) {
    throw new SourceOneCsvError('Generated grade codes are not unique');
  }

  return {
    totalRows,
    validRows: valid.length,
    invalid,
    warnings,
    duplicates,
    categories: [...categories.values()],
    gradeGroups: [...gradeGroups.values()],
    grades,
  };
}
