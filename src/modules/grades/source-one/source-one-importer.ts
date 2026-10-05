import {
  EntityOwnerType,
  GradeImportStatus,
  GradeStatus,
  MasterStatus,
  Prisma,
  type PrismaClient,
} from '../../../generated/prisma/client.js';
import {
  displayNameOf,
  type PlannedGrade,
  planSourceOneImport,
  SOURCE_ONE,
  sha256,
  type SourceOnePlan,
} from './source-one-csv.js';

export type GradeImportTrigger = 'ADMIN' | 'CLI' | 'BUNDLED';

export type GradeImportOptions = {
  csv: string;
  fileName: string;
  trigger: GradeImportTrigger;
  actorUserId?: string;
  /** Validate and diff against the database without writing anything. */
  dryRun?: boolean;
};

export type GradeImportSummary = {
  batchId: string | null;
  dryRun: boolean;
  fileName: string;
  fileSha256: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  grades: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  categoriesCreated: number;
  gradeGroupsCreated: number;
  /** Source.One grades already in the database that this file no longer contains. */
  notInFile: number;
};

const CHUNK = 500;
const REPORT_LIMIT = 200;
/** Advisory lock id so concurrent instances / requests never import at once. */
const IMPORT_LOCK_ID = 7_351_204_118;

type ExistingGrade = {
  id: string;
  sourceKey: string | null;
  displayName: string | null;
  gradeGroup: string | null;
  gradeNo: string | null;
  manufacturer: string | null;
  fullGradeName: string | null;
  inTodaysDelhiPriceList: boolean;
  priceTodayRsKg: Prisma.Decimal | null;
  producerPriceRsKg: Prisma.Decimal | null;
  producerPriceType: string | null;
  categoryId: string;
  subcategoryId: string | null;
  sourceReference: string | null;
};

function money(value: Prisma.Decimal | string | null): string | null {
  return value == null ? null : new Prisma.Decimal(value).toFixed(2);
}

function sourceReferenceOf(fileName: string, grade: PlannedGrade): string {
  return `${fileName}#L${grade.lines.join(',L')}`;
}

function sourceColumns(
  grade: PlannedGrade,
  ids: { categoryId: string; subcategoryId: string },
  fileName: string,
) {
  return {
    gradeGroup: grade.gradeGroup,
    gradeNo: grade.gradeNo,
    manufacturer: grade.manufacturer,
    fullGradeName: grade.fullGradeName,
    inTodaysDelhiPriceList: grade.inTodaysDelhiPriceList,
    priceTodayRsKg: grade.priceTodayRsKg,
    producerPriceRsKg: grade.producerPriceRsKg,
    producerPriceType: grade.producerPriceType,
    categoryId: ids.categoryId,
    subcategoryId: ids.subcategoryId,
    sourceReference: sourceReferenceOf(fileName, grade),
  };
}

function hasSourceChanges(
  existing: ExistingGrade,
  next: ReturnType<typeof sourceColumns>,
): boolean {
  return (
    existing.gradeGroup !== next.gradeGroup ||
    existing.gradeNo !== next.gradeNo ||
    existing.manufacturer !== next.manufacturer ||
    existing.fullGradeName !== next.fullGradeName ||
    existing.inTodaysDelhiPriceList !== next.inTodaysDelhiPriceList ||
    money(existing.priceTodayRsKg) !== money(next.priceTodayRsKg) ||
    money(existing.producerPriceRsKg) !== money(next.producerPriceRsKg) ||
    existing.producerPriceType !== next.producerPriceType ||
    existing.categoryId !== next.categoryId ||
    existing.subcategoryId !== next.subcategoryId
  );
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function buildReport(plan: SourceOnePlan, notInFile: string[]) {
  return {
    invalid: plan.invalid.slice(0, REPORT_LIMIT),
    invalidTotal: plan.invalid.length,
    warnings: plan.warnings.slice(0, REPORT_LIMIT),
    warningsTotal: plan.warnings.length,
    duplicates: plan.duplicates,
    notInFile: notInFile.slice(0, REPORT_LIMIT),
    notInFileTotal: notInFile.length,
    categories: plan.categories.length,
    gradeGroups: plan.gradeGroups.length,
  } satisfies Prisma.InputJsonObject;
}

type Tx = Prisma.TransactionClient;

async function ensureCategories(tx: Tx, plan: SourceOnePlan) {
  const existing = await tx.gradeCategory.findMany({
    where: { code: { in: plan.categories.map((c) => c.code) } },
    select: { id: true, code: true },
  });
  const ids = new Map(existing.map((c) => [c.code, c.id]));
  const missing = plan.categories.filter((c) => !ids.has(c.code));
  if (missing.length) {
    await tx.gradeCategory.createMany({
      data: missing.map((c) => ({
        code: c.code,
        name: c.name,
        displayName: c.name,
        parentGroup: c.parentGroup,
        status: MasterStatus.ACTIVE,
      })),
      skipDuplicates: true,
    });
    const created = await tx.gradeCategory.findMany({
      where: { code: { in: missing.map((c) => c.code) } },
      select: { id: true, code: true },
    });
    for (const c of created) ids.set(c.code, c.id);
  }
  return { ids, created: missing.length };
}

async function ensureGradeGroups(
  tx: Tx,
  plan: SourceOnePlan,
  categoryIds: Map<string, string>,
) {
  const wanted = plan.gradeGroups.map((g) => ({
    ...g,
    categoryId: categoryIds.get(g.categoryCode)!,
  }));
  const load = () =>
    tx.subcategory.findMany({
      where: {
        categoryId: { in: [...new Set(wanted.map((g) => g.categoryId))] },
      },
      select: { id: true, categoryId: true, code: true },
    });
  const ids = new Map(
    (await load()).map((s) => [`${s.categoryId}|${s.code}`, s.id]),
  );
  const missing = wanted.filter((g) => !ids.has(`${g.categoryId}|${g.code}`));
  if (missing.length) {
    await tx.subcategory.createMany({
      data: missing.map((g) => ({
        categoryId: g.categoryId,
        code: g.code,
        name: g.name,
        displayName: g.name,
        status: MasterStatus.ACTIVE,
      })),
      skipDuplicates: true,
    });
    for (const s of await load()) ids.set(`${s.categoryId}|${s.code}`, s.id);
  }
  return { ids, created: missing.length };
}

async function loadExisting(client: Tx | PrismaClient) {
  const rows: ExistingGrade[] = await client.grade.findMany({
    where: { source: SOURCE_ONE },
    select: {
      id: true,
      sourceKey: true,
      displayName: true,
      gradeGroup: true,
      gradeNo: true,
      manufacturer: true,
      fullGradeName: true,
      inTodaysDelhiPriceList: true,
      priceTodayRsKg: true,
      producerPriceRsKg: true,
      producerPriceType: true,
      categoryId: true,
      subcategoryId: true,
      sourceReference: true,
    },
  });
  return new Map(rows.map((r) => [r.sourceKey ?? '', r]));
}

/**
 * Imports a Source.One grade master CSV into the central Grade table.
 *
 * Idempotent: grades are matched on (source, sourceKey). New grades are
 * inserted ACTIVE and visible to customers and sellers. For existing grades
 * only Source.One columns are refreshed; Admin-managed fields (status,
 * visibility, sort order, HSN, description, edited display names) are never
 * changed, and grades missing from the file are reported, not deactivated.
 * All writes run in one transaction, so a failure leaves the data unchanged.
 */
export async function importSourceOneGrades(
  prisma: PrismaClient,
  options: GradeImportOptions,
): Promise<GradeImportSummary> {
  const fileSha256 = sha256(options.csv);
  const base = {
    dryRun: Boolean(options.dryRun),
    fileName: options.fileName,
    fileSha256,
  };

  let plan: SourceOnePlan;
  try {
    plan = planSourceOneImport(options.csv);
  } catch (error) {
    if (!options.dryRun) {
      await prisma.gradeImportBatch.create({
        data: {
          source: SOURCE_ONE,
          fileName: options.fileName,
          fileSha256,
          trigger: options.trigger,
          createdById: options.actorUserId,
          status: GradeImportStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
        },
      });
    }
    throw error;
  }

  const duplicateRows = plan.duplicates.reduce(
    (sum, d) => sum + d.mergedLines.length,
    0,
  );
  const counts = {
    totalRows: plan.totalRows,
    validRows: plan.validRows,
    invalidRows: plan.totalRows - plan.validRows,
    duplicateRows,
    grades: plan.grades.length,
  };

  if (options.dryRun) {
    const existing = await loadExisting(prisma);
    const keys = new Set(plan.grades.map((g) => g.sourceKey));
    const known = plan.grades.filter((g) => existing.has(g.sourceKey)).length;
    return {
      batchId: null,
      ...base,
      ...counts,
      inserted: plan.grades.length - known,
      updated: 0,
      unchanged: known,
      skipped: counts.invalidRows,
      categoriesCreated: 0,
      gradeGroupsCreated: 0,
      notInFile: [...existing.keys()].filter((k) => !keys.has(k)).length,
    };
  }

  const batch = await prisma.gradeImportBatch.create({
    data: {
      source: SOURCE_ONE,
      fileName: options.fileName,
      fileSha256,
      trigger: options.trigger,
      createdById: options.actorUserId,
      totalRows: plan.totalRows,
      validRows: plan.validRows,
    },
  });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_ID}::bigint)`;
        const now = new Date();

        const categories = await ensureCategories(tx, plan);
        const groups = await ensureGradeGroups(tx, plan, categories.ids);
        const existing = await loadExisting(tx);

        const toCreate: Prisma.GradeCreateManyInput[] = [];
        const toUpdate: Array<{
          id: string;
          data: Prisma.GradeUncheckedUpdateInput;
        }> = [];
        const unchangedIds: string[] = [];
        const moved: Array<{ id: string; sourceReference: string }> = [];

        for (const grade of plan.grades) {
          const categoryId = categories.ids.get(grade.categoryCode)!;
          const subcategoryId = groups.ids.get(
            `${categoryId}|${grade.gradeGroupCode}`,
          )!;
          const columns = sourceColumns(
            grade,
            { categoryId, subcategoryId },
            options.fileName,
          );
          const current = existing.get(grade.sourceKey);

          if (!current) {
            toCreate.push({
              ...columns,
              code: grade.code,
              name: grade.gradeNo,
              displayName: grade.displayName,
              status: GradeStatus.ACTIVE,
              customerVisible: true,
              sellerVisible: true,
              source: SOURCE_ONE,
              sourceKey: grade.sourceKey,
              version: 1,
              lastImportedAt: now,
              importBatchId: batch.id,
              createdById: options.actorUserId,
              updatedById: options.actorUserId,
            });
          } else if (hasSourceChanges(current, columns)) {
            const derivedBefore = current.gradeNo
              ? displayNameOf({
                  gradeGroup: current.gradeGroup ?? '',
                  gradeNo: current.gradeNo,
                  manufacturer: current.manufacturer,
                  fullGradeName: current.fullGradeName,
                })
              : null;
            const keepEditedName =
              current.displayName != null &&
              current.displayName !== derivedBefore;
            toUpdate.push({
              id: current.id,
              data: {
                ...columns,
                ...(keepEditedName ? {} : { displayName: grade.displayName }),
                version: { increment: 1 },
                lastImportedAt: now,
                importBatchId: batch.id,
                updatedById: options.actorUserId ?? null,
              },
            });
          } else if (current.sourceReference !== columns.sourceReference) {
            // Same data on different CSV lines: refresh the pointer, no new version.
            moved.push({
              id: current.id,
              sourceReference: columns.sourceReference,
            });
          } else {
            unchangedIds.push(current.id);
          }
        }

        for (const part of chunks(toCreate)) {
          await tx.grade.createMany({ data: part });
        }
        for (const { id, data } of toUpdate) {
          await tx.grade.update({ where: { id }, data });
        }
        for (const { id, sourceReference } of moved) {
          await tx.grade.update({
            where: { id },
            data: {
              sourceReference,
              lastImportedAt: now,
              importBatchId: batch.id,
            },
          });
        }
        for (const part of chunks(unchangedIds)) {
          await tx.grade.updateMany({
            where: { id: { in: part } },
            data: { lastImportedAt: now },
          });
        }

        const fileKeys = new Set(plan.grades.map((g) => g.sourceKey));
        const notInFile = [...existing.keys()].filter((k) => !fileKeys.has(k));

        return {
          inserted: toCreate.length,
          updated: toUpdate.length,
          unchanged: unchangedIds.length + moved.length,
          categoriesCreated: categories.created,
          gradeGroupsCreated: groups.created,
          notInFile,
        };
      },
      { timeout: 600_000, maxWait: 30_000 },
    );

    await prisma.gradeImportBatch.update({
      where: { id: batch.id },
      data: {
        status: GradeImportStatus.COMPLETED,
        insertedRows: result.inserted,
        updatedRows: result.updated,
        unchangedRows: result.unchanged,
        skippedRows: counts.invalidRows,
        failedRows: counts.invalidRows,
        duplicateRows,
        categoriesCreated: result.categoriesCreated,
        gradeGroupsCreated: result.gradeGroupsCreated,
        report: buildReport(plan, result.notInFile),
        completedAt: new Date(),
      },
    });

    const summary: GradeImportSummary = {
      batchId: batch.id,
      ...base,
      ...counts,
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: counts.invalidRows,
      categoriesCreated: result.categoriesCreated,
      gradeGroupsCreated: result.gradeGroupsCreated,
      notInFile: result.notInFile.length,
    };

    await prisma.auditLog.create({
      data: {
        action: 'GRADE_IMPORTED',
        actorUserId: options.actorUserId,
        entityType: EntityOwnerType.GRADE,
        newData: summary as unknown as Prisma.InputJsonObject,
        metadata: { batchId: batch.id, trigger: options.trigger },
      },
    });

    return summary;
  } catch (error) {
    await prisma.gradeImportBatch.update({
      where: { id: batch.id },
      data: {
        status: GradeImportStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
