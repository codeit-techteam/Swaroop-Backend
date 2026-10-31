/**
 * Category display-name audit (read-only — changes nothing).
 *
 * Lists every grade category with the label customers currently see, and flags the
 * ones whose label is only an AUTOMATIC guess (derived from the internal code) rather
 * than an explicitly set display name. The client must confirm/replace those; do NOT
 * treat the auto-derived label as the final mapping.
 *
 * Usage:
 *   npx tsx scripts/report-category-labels.ts            # markdown to stdout
 *   npx tsx scripts/report-category-labels.ts --json     # JSON to stdout
 *   npx tsx scripts/report-category-labels.ts --csv > categories.csv
 *
 * Final names are applied by an admin via PATCH /admin/categories/:id { displayName }
 * (Admin panel → Categories), never by editing code.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  formatCategoryDisplayName,
  isInternalMasterCode,
} from '../src/modules/grades/common/category-label.js';

type LabelSource =
  | 'EXPLICIT' // admin/seed set a displayName — treat as proposed, client to confirm
  | 'AUTO_DERIVED' // no displayName; label guessed from name/code
  | 'RAW_CODE_RISK'; // effective label still looks like an internal code

export interface CategoryLabelRow {
  id: string;
  code: string;
  name: string;
  storedDisplayName: string | null;
  customerSees: string;
  source: LabelSource;
  parentGroup: string;
  grades: number;
  active: boolean;
  needsClientConfirmation: boolean;
  issues: string[];
}

export function classifyCategory(c: {
  id: string;
  code: string;
  name: string;
  displayName: string | null;
  parentGroup: string;
  isActive: boolean;
  grades: number;
}): CategoryLabelRow {
  const customerSees = formatCategoryDisplayName(c.displayName, c.name, c.code);
  const stored = c.displayName?.trim() || null;
  const issues: string[] = [];

  if (/_/.test(customerSees)) issues.push('label contains underscore');
  if (isInternalMasterCode(customerSees))
    issues.push('label still looks like an internal code');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(customerSees))
    issues.push('label is a UUID');
  if (!customerSees) issues.push('empty label');
  if (stored && stored === c.code && /_/.test(stored))
    issues.push('displayName equals raw code');
  if (customerSees === customerSees.toUpperCase() && customerSees.length > 6)
    issues.push('all-caps label (confirm intended casing)');

  let source: LabelSource = stored ? 'EXPLICIT' : 'AUTO_DERIVED';
  if (isInternalMasterCode(customerSees) || /_/.test(customerSees))
    source = 'RAW_CODE_RISK';

  return {
    id: c.id,
    code: c.code,
    name: c.name,
    storedDisplayName: stored,
    customerSees,
    source,
    parentGroup: c.parentGroup,
    grades: c.grades,
    active: c.isActive,
    // Everything not explicitly set is a guess; explicit ones still await sign-off.
    needsClientConfirmation: true,
    issues,
  };
}

function esc(v: string | number | boolean | null): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

async function main() {
  const adapter = new PrismaPg({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/swaroop?schema=public',
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const cats = await prisma.gradeCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ parentGroup: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        displayName: true,
        parentGroup: true,
        isActive: true,
        _count: { select: { grades: { where: { deletedAt: null } } } },
      },
    });
    const rows = cats.map((c) =>
      classifyCategory({ ...c, grades: c._count.grades }),
    );

    const mode = process.argv.includes('--json')
      ? 'json'
      : process.argv.includes('--csv')
        ? 'csv'
        : 'md';

    if (mode === 'json') {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (mode === 'csv') {
      console.log(
        'code,current_name,stored_display_name,customer_sees,source,parent_group,grades,issues,CLIENT_FINAL_NAME',
      );
      for (const r of rows) {
        console.log(
          [
            r.code,
            r.name,
            r.storedDisplayName,
            r.customerSees,
            r.source,
            r.parentGroup,
            r.grades,
            r.issues.join('; '),
            '',
          ]
            .map(esc)
            .join(','),
        );
      }
      return;
    }

    const auto = rows.filter((r) => r.source !== 'EXPLICIT');
    console.log('# Category display-name audit\n');
    console.log(`Categories: ${rows.length}`);
    console.log(`Explicit displayName set: ${rows.length - auto.length}`);
    console.log(
      `Auto-derived (guess — needs client confirmation): ${auto.length}`,
    );
    console.log(`With issues: ${rows.filter((r) => r.issues.length).length}\n`);
    console.log(
      '| Code | Stored name | Stored displayName | Customer currently sees | Source | Grades | Issues | CLIENT FINAL NAME |',
    );
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log(
        `| ${r.code} | ${r.name} | ${r.storedDisplayName ?? '—'} | ${r.customerSees} | ${r.source} | ${r.grades} | ${r.issues.join('; ') || '—'} | _(pending)_ |`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('report-category-labels.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
