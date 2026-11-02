import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  TdsImportBatchStatus,
  TdsSourceKind,
  TdsVerificationStatus,
} from '../../generated/prisma/client.js';
import {
  loadGradeMatchIndex,
  matchGradeFromIndex,
} from './tds-grade-matcher.js';
import {
  buildGradeTdsObjectKey,
  buildImportKey,
  classifySourceKind,
  initialVerificationStatus,
  isAllowedTdsMime,
  mimeFromFilename,
  normalizeMatchToken,
} from './tds-normalize.js';

const execFileAsync = promisify(execFile);

export type TdsImportOptions = {
  excelPath: string;
  zipPaths: string[];
  dryRun?: boolean;
  trigger?: string;
  createdById?: string;
  /** Cap uploads (for smoke tests). */
  limit?: number;
  workDir?: string;
};

export type TdsImportManifestRow = {
  sheet: 'TDS Index' | 'Missing TDS' | 'Full Catalogue';
  category: string;
  grade: string;
  producer: string;
  workbookAvailability: string | null;
  sourceRaw: string | null;
  sourceUrl: string | null;
  sourceFilePath: string | null;
  workbookNotes: string | null;
  importKey: string;
  decision:
    | 'UPLOAD'
    | 'MISSING_RECORD'
    | 'SKIP_NO_FILE'
    | 'SKIP_DUPLICATE_CHECKSUM'
    | 'SKIP_INVALID'
    | 'AMBIGUOUS'
    | 'UNMATCHED_GRADE';
  mappingConfidence: string | null;
  gradeId: string | null;
  archivePath: string | null;
  checksum: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  verificationStatus: TdsVerificationStatus;
  sourceKind: TdsSourceKind;
  notes: string[];
};

export type TdsImportReport = {
  batchId: string | null;
  dryRun: boolean;
  excelRows: { index: number; missing: number; catalogue: number };
  zipFiles: number;
  exactFileMatches: number;
  missingFiles: number;
  unmatchedArchiveFiles: number;
  duplicateChecksums: number;
  ambiguousMappings: number;
  unmatchedGrades: number;
  uploaded: number;
  skippedExisting: number;
  missingRecords: number;
  failed: number;
  rows: TdsImportManifestRow[];
  sampleIssues: string[];
};

type ArchiveFile = {
  absolutePath: string;
  relativePath: string;
  baseName: string;
  size: number;
};

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v && 'text' in (v as object)) {
    return String((v as { text?: string }).text ?? '').trim();
  }
  return String(v).trim();
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function shouldIgnoreArchiveEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.endsWith('/')) return true;
  if (n.includes('__MACOSX')) return true;
  if (n.endsWith('.DS_Store')) return true;
  const base = basename(n);
  if (base.startsWith('.')) return true;
  return false;
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
}

function walkFiles(root: string, base = root): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX' || entry.name.startsWith('.')) continue;
      out.push(...walkFiles(abs, base));
      continue;
    }
    const rel = relative(base, abs).replace(/\\/g, '/');
    if (shouldIgnoreArchiveEntry(rel)) continue;
    out.push({
      absolutePath: abs,
      relativePath: rel,
      baseName: basename(abs),
      size: statSync(abs).size,
    });
  }
  return out;
}

async function readSheetRows(
  workbook: ExcelJS.Workbook,
  sheetName: string,
): Promise<Record<string, string>[]> {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellStr(cell.value);
  });
  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let empty = true;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = cellStr(row.getCell(col).value);
      obj[h] = v;
      if (v) empty = false;
    });
    if (!empty) rows.push(obj);
  });
  return rows;
}

function createR2ClientFromEnv(): {
  client: S3Client;
  bucket: string;
  publicUrl: string;
} | null {
  const accountId =
    process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ||
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
    '';
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    '';
  const bucket =
    process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME || '';
  const publicUrl =
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.CLOUDFLARE_R2_PUBLIC_URL ||
    '';
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint =
    process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    client: new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicUrl,
  };
}

async function objectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function importTdsLibrary(
  prisma: PrismaClient,
  options: TdsImportOptions,
): Promise<TdsImportReport> {
  const dryRun = Boolean(options.dryRun);
  const workRoot =
    options.workDir ??
    join(tmpdir(), `polystore-tds-import-${randomUUID()}`);
  mkdirSync(workRoot, { recursive: true });

  const report: TdsImportReport = {
    batchId: null,
    dryRun,
    excelRows: { index: 0, missing: 0, catalogue: 0 },
    zipFiles: 0,
    exactFileMatches: 0,
    missingFiles: 0,
    unmatchedArchiveFiles: 0,
    duplicateChecksums: 0,
    ambiguousMappings: 0,
    unmatchedGrades: 0,
    uploaded: 0,
    skippedExisting: 0,
    missingRecords: 0,
    failed: 0,
    rows: [],
    sampleIssues: [],
  };

  let batchId: string | null = null;
  if (!dryRun) {
    const batch = await prisma.tdsImportBatch.create({
      data: {
        status: TdsImportBatchStatus.RUNNING,
        dryRun: false,
        excelFileName: basename(options.excelPath),
        zipFileNames: options.zipPaths.map((p) => basename(p)),
        trigger: options.trigger ?? 'CLI',
        createdById: options.createdById ?? null,
      },
    });
    batchId = batch.id;
    report.batchId = batchId;
  } else {
    report.batchId = null;
  }

  try {
    // Extract ZIPs
    const extractRoot = join(workRoot, 'extracted');
    mkdirSync(extractRoot, { recursive: true });
    for (const [i, zip] of options.zipPaths.entries()) {
      if (!existsSync(zip)) throw new Error(`ZIP not found: ${zip}`);
      console.log(`Extracting ${basename(zip)}…`);
      await extractZip(zip, join(extractRoot, `part${i + 1}`));
    }
    const archiveFiles = walkFiles(extractRoot);
    report.zipFiles = archiveFiles.length;
    console.log(`Extracted ${archiveFiles.length} document files`);

    const byBase = new Map<string, ArchiveFile[]>();
    const byRel = new Map<string, ArchiveFile>();
    for (const f of archiveFiles) {
      const list = byBase.get(f.baseName.toLowerCase()) ?? [];
      list.push(f);
      byBase.set(f.baseName.toLowerCase(), list);
      byRel.set(f.relativePath.toLowerCase(), f);
      // also index without partN/ prefix
      const stripped = f.relativePath.replace(/^part\d+\//i, '');
      byRel.set(stripped.toLowerCase(), f);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(options.excelPath);
    const indexRows = await readSheetRows(workbook, 'TDS Index');
    const missingRows = await readSheetRows(workbook, 'Missing TDS');
    const catalogueRows = await readSheetRows(workbook, 'Full Catalogue');
    report.excelRows = {
      index: indexRows.length,
      missing: missingRows.length,
      catalogue: catalogueRows.length,
    };

    console.log('Loading grade match index…');
    const gradeIndex = await loadGradeMatchIndex(prisma);
    console.log(`Grade index loaded (${gradeIndex.all.length} grades)`);
    const checksumSeen = new Map<string, string>();
    const matchedArchive = new Set<string>();

    const r2 = dryRun ? null : createR2ClientFromEnv();
    if (!dryRun && !r2) {
      throw new Error(
        'R2 credentials missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (or CLOUDFLARE_R2_* aliases).',
      );
    }
    if (r2) console.log(`R2 ready (bucket=${r2.bucket})`);

    const processIndexRow = async (
      row: Record<string, string>,
      sheet: 'TDS Index' | 'Full Catalogue',
    ) => {
      const category =
        cellStr(row.Category) ||
        cellStr(row.Chip) ||
        cellStr(row.Polymer) ||
        '';
      const grade = cellStr(row.Grade);
      const producer = cellStr(row.Producer);
      const availability =
        cellStr(row['TDS available']) || cellStr(row['TDS status']) || null;
      const sourceRaw = cellStr(row.Source) || null;
      const sourceUrl = cellStr(row['TDS link']) || null;
      const filePath =
        cellStr(row['File name']) || cellStr(row.File) || null;
      const notes: string[] = [];

      const importKey = buildImportKey({
        category,
        grade,
        producer,
        filePath: filePath && filePath !== '-' ? filePath : `missing:${grade}`,
      });

      const sourceKind = classifySourceKind(
        availability,
        sourceRaw,
      ) as TdsSourceKind;

      const match = matchGradeFromIndex(gradeIndex, {
        category,
        grade,
        producer,
      });

      const availLower = String(availability ?? '').toLowerCase();
      const wantsFile = availLower.startsWith('yes');
      const noFile =
        !filePath ||
        filePath === '-' ||
        availLower.startsWith('no') ||
        sourceKind === 'UNKNOWN';

      let archive: ArchiveFile | null = null;
      if (filePath && filePath !== '-') {
        const normalized = filePath.replace(/\\/g, '/');
        const base = basename(normalized);
        archive =
          byRel.get(normalized.toLowerCase()) ??
          byRel.get(base.toLowerCase()) ??
          null;
        if (!archive) {
          const hits = byBase.get(base.toLowerCase()) ?? [];
          archive = hits[0] ?? null;
        }
        if (archive) {
          matchedArchive.add(archive.absolutePath);
          report.exactFileMatches += 1;
        } else if (wantsFile) {
          report.missingFiles += 1;
          notes.push(`File not found in ZIPs: ${filePath}`);
        }
      }

      const ambiguous = match.confidence === 'ambiguous';
      if (ambiguous) report.ambiguousMappings += 1;
      if (!match.gradeId && match.confidence !== 'ambiguous') {
        report.unmatchedGrades += 1;
      }

      let checksum: string | null = null;
      let mimeType: string | null = null;
      let fileSizeBytes: number | null = null;

      if (archive) {
        checksum = sha256File(archive.absolutePath);
        mimeType = mimeFromFilename(archive.baseName);
        fileSizeBytes = archive.size;
        if (!isAllowedTdsMime(mimeType)) {
          notes.push(`Invalid MIME ${mimeType}`);
        }
        const prev = checksumSeen.get(checksum);
        if (prev && prev !== importKey) {
          report.duplicateChecksums += 1;
          notes.push(`Duplicate checksum of ${prev}`);
        } else {
          checksumSeen.set(checksum, importKey);
        }
      }

      const hasFile = Boolean(archive);
      const verificationStatus = initialVerificationStatus({
        sourceKind: sourceKind as Parameters<
          typeof initialVerificationStatus
        >[0]['sourceKind'],
        hasFile,
        gradeMatched: Boolean(match.gradeId),
        ambiguous,
      }) as TdsVerificationStatus;

      let decision: TdsImportManifestRow['decision'] = 'UPLOAD';
      if (!hasFile) {
        decision =
          wantsFile && filePath && filePath !== '-'
            ? 'SKIP_NO_FILE'
            : 'MISSING_RECORD';
      } else if (ambiguous) {
        decision = 'AMBIGUOUS';
      } else if (!match.gradeId) {
        decision = 'UNMATCHED_GRADE';
      } else if (mimeType && !isAllowedTdsMime(mimeType)) {
        decision = 'SKIP_INVALID';
      }

      const manifestRow: TdsImportManifestRow = {
        sheet,
        category,
        grade,
        producer,
        workbookAvailability: availability,
        sourceRaw,
        sourceUrl,
        sourceFilePath: filePath,
        workbookNotes: null,
        importKey,
        decision,
        mappingConfidence: match.confidence,
        gradeId: match.gradeId,
        archivePath: archive?.relativePath ?? null,
        checksum,
        mimeType,
        fileSizeBytes,
        verificationStatus,
        sourceKind,
        notes: [...notes, match.reason],
      };
      report.rows.push(manifestRow);

      if (dryRun) {
        if (decision === 'MISSING_RECORD') report.missingRecords += 1;
        return;
      }

      const existing = await prisma.gradeTdsDocument.findUnique({
        where: { importKey },
      });
      if (existing) {
        report.skippedExisting += 1;
        return;
      }

      if (decision === 'SKIP_NO_FILE' || decision === 'SKIP_INVALID') {
        report.failed += 1;
        if (report.sampleIssues.length < 40) {
          report.sampleIssues.push(
            `${grade}/${producer}: ${decision} — ${notes.join('; ')}`,
          );
        }
        return;
      }

      let storageKey: string | null = null;
      let uploadedAt: Date | null = null;

      if (archive && r2 && (decision === 'UPLOAD' || decision === 'AMBIGUOUS' || decision === 'UNMATCHED_GRADE')) {
        storageKey = buildGradeTdsObjectKey({
          category,
          grade,
          producer,
          revision: 1,
          filename: archive.baseName,
        });
        const already = await objectExists(r2.client, r2.bucket, storageKey);
        if (!already) {
          const body = readFileSync(archive.absolutePath);
          await r2.client.send(
            new PutObjectCommand({
              Bucket: r2.bucket,
              Key: storageKey,
              Body: body,
              ContentType: mimeType ?? 'application/octet-stream',
              Metadata: {
                checksum: checksum ?? '',
                importkey: importKey.slice(0, 200),
              },
            }),
          );
        }
        uploadedAt = new Date();
        report.uploaded += 1;
      }

      if (decision === 'MISSING_RECORD') {
        report.missingRecords += 1;
      }

      await prisma.gradeTdsDocument.create({
        data: {
          importKey,
          gradeId: match.gradeId,
          categoryCode: category || 'UNKNOWN',
          gradeCode: grade || 'UNKNOWN',
          producerName: producer || 'UNKNOWN',
          documentTitle: `${category} ${grade} – ${producer}`.trim(),
          documentType: 'TDS',
          originalFilename: archive?.baseName ?? null,
          storageKey,
          mimeType,
          fileSizeBytes: fileSizeBytes != null ? BigInt(fileSizeBytes) : null,
          checksum,
          sourceKind,
          sourceRaw,
          sourceUrl,
          sourceFilePath: filePath,
          workbookAvailability: availability,
          verificationStatus,
          mappingConfidence: match.confidence,
          importBatchId: batchId,
          revision: 1,
          isActive: true,
          uploadedAt,
          approvedAt:
            verificationStatus === TdsVerificationStatus.VERIFIED
              ? new Date()
              : null,
          reviewNotes: notes.join(' | ') || null,
        },
      });
    };

    let processed = 0;
    const indexTotal =
      options.limit != null
        ? Math.min(options.limit, indexRows.length)
        : indexRows.length;
    console.log(`Processing TDS Index (${indexTotal} rows)…`);
    for (const row of indexRows) {
      if (options.limit != null && processed >= options.limit) break;
      await processIndexRow(row, 'TDS Index');
      processed += 1;
      if (processed % 25 === 0 || processed === indexTotal) {
        console.log(
          `  Index ${processed}/${indexTotal} — uploaded=${report.uploaded} skipped=${report.skippedExisting} missing=${report.missingRecords} failed=${report.failed}`,
        );
      }
    }

    // Missing TDS sheet → availability records only
    console.log(`Processing Missing TDS (${missingRows.length} rows)…`);
    for (const row of missingRows) {
      if (options.limit != null && processed >= options.limit) break;
      const category = cellStr(row.Category);
      const grade = cellStr(row.Grade);
      const producer = cellStr(row.Producer);
      const getFrom = cellStr(row['Get from']);
      const statusNotes = cellStr(row['Status/notes']);
      const importKey = buildImportKey({
        category,
        grade,
        producer,
        filePath: `missing-sheet:${normalizeMatchToken(grade)}`,
      });
      const match = matchGradeFromIndex(gradeIndex, {
        category,
        grade,
        producer,
      });
      const manifestRow: TdsImportManifestRow = {
        sheet: 'Missing TDS',
        category,
        grade,
        producer,
        workbookAvailability: 'no',
        sourceRaw: getFrom || null,
        sourceUrl: null,
        sourceFilePath: null,
        workbookNotes: statusNotes || null,
        importKey,
        decision: 'MISSING_RECORD',
        mappingConfidence: match.confidence,
        gradeId: match.gradeId,
        archivePath: null,
        checksum: null,
        mimeType: null,
        fileSizeBytes: null,
        verificationStatus: TdsVerificationStatus.MISSING,
        sourceKind: TdsSourceKind.UNKNOWN,
        notes: [match.reason, statusNotes].filter(Boolean),
      };
      report.rows.push(manifestRow);
      report.missingRecords += 1;
      processed += 1;

      if (dryRun) continue;
      const existing = await prisma.gradeTdsDocument.findUnique({
        where: { importKey },
      });
      if (existing) {
        report.skippedExisting += 1;
        continue;
      }
      await prisma.gradeTdsDocument.create({
        data: {
          importKey,
          gradeId: match.gradeId,
          categoryCode: category || 'UNKNOWN',
          gradeCode: grade || 'UNKNOWN',
          producerName: producer || 'UNKNOWN',
          documentTitle: `${category} ${grade} – ${producer}`.trim(),
          documentType: 'TDS',
          sourceKind: TdsSourceKind.UNKNOWN,
          sourceRaw: getFrom || null,
          workbookAvailability: 'no',
          workbookNotes: statusNotes || null,
          verificationStatus: TdsVerificationStatus.MISSING,
          mappingConfidence: match.confidence,
          importBatchId: batchId,
          isActive: true,
          reviewNotes: statusNotes || null,
        },
      });
    }

    report.unmatchedArchiveFiles = archiveFiles.filter(
      (f) => !matchedArchive.has(f.absolutePath),
    ).length;

    // Write report artifact
    const reportPath = join(workRoot, 'import-report.json');
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          ...report,
          rows: report.rows.slice(0, 2000),
          reportPath,
        },
        null,
        2,
      ),
    );

    if (batchId) {
      await prisma.tdsImportBatch.update({
        where: { id: batchId },
        data: {
          status: TdsImportBatchStatus.COMPLETED,
          completedAt: new Date(),
          stats: {
            excelRows: report.excelRows,
            zipFiles: report.zipFiles,
            exactFileMatches: report.exactFileMatches,
            missingFiles: report.missingFiles,
            unmatchedArchiveFiles: report.unmatchedArchiveFiles,
            duplicateChecksums: report.duplicateChecksums,
            ambiguousMappings: report.ambiguousMappings,
            unmatchedGrades: report.unmatchedGrades,
            uploaded: report.uploaded,
            skippedExisting: report.skippedExisting,
            missingRecords: report.missingRecords,
            failed: report.failed,
          },
          report: {
            sampleIssues: report.sampleIssues,
            reportPath,
          },
        },
      });
    }

    return report;
  } catch (error) {
    if (batchId) {
      await prisma.tdsImportBatch.update({
        where: { id: batchId },
        data: {
          status: TdsImportBatchStatus.FAILED,
          completedAt: new Date(),
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      });
    }
    throw error;
  } finally {
    // Keep work dir for audit; caller may delete. Soft cleanup of huge extracts optional.
    if (process.env.TDS_IMPORT_CLEANUP === '1') {
      try {
        rmSync(workRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
