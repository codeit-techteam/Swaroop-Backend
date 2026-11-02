/**
 * Normalized matching helpers for grade ↔ TDS library association.
 * Never match on grade number alone — always pair with producer when possible.
 */

export function normalizeMatchToken(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip parenthetical producer aliases: "SABIC (PE100)" → "SABIC". */
export function producerBaseName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  const withoutParen = raw.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return normalizeMatchToken(withoutParen || raw);
}

/**
 * Common catalogue vs storage-path producer spellings.
 * Keys/values are already normalizeMatchToken'd (uppercase, spaces).
 * Example: R2 path EXXONMOBIL_VISTAMAX must match grade manufacturer EXXON.
 */
const PRODUCER_ALIAS_GROUPS: string[][] = [
  ['EXXON', 'EXXONMOBIL', 'EXXON MOBIL', 'EXXONMOBIL CHEMICAL'],
  ['DOW', 'DOW CHEMICAL', 'DOWCHEMICAL'],
  ['LG', 'LG CHEM', 'LGCHEM', 'LG CHEMICAL'],
  ['SABIC', 'SAUDI BASIC'],
  ['BOROUGE', 'ABU DHABI POLYMERS'],
  ['RELIANCE', 'RIL', 'RELIANCE INDUSTRIES'],
  ['INEOS', 'INEOS STYROLUTION'],
  ['TOTAL', 'TOTALENERGIES', 'TOTAL ENERGIES'],
  ['MOL', 'MOLGROUP', 'MOL GROUP'],
  ['BASELL', 'LYONDELLBASELL', 'LYONDELL BASELL'],
];

function expandKnownProducerAliases(token: string): string[] {
  const out: string[] = [];
  for (const group of PRODUCER_ALIAS_GROUPS) {
    if (group.includes(token)) {
      out.push(...group);
    }
  }
  return out;
}

/**
 * Tokens used to pair a TDS producer path/name with grade.manufacturer.
 * Never match on grade number alone — callers must still require a shared token.
 */
export function producerAliasTokens(value: string | null | undefined): string[] {
  const raw = String(value ?? '').trim();
  const tokens = new Set<string>();
  const full = normalizeMatchToken(raw);
  if (full) tokens.add(full);
  const base = producerBaseName(raw);
  if (base) tokens.add(base);

  const paren = raw.match(/\(([^)]+)\)/g) ?? [];
  for (const p of paren) {
    const inner = normalizeMatchToken(p.replace(/[()]/g, ''));
    if (inner) tokens.add(inner);
  }

  // EXXONMOBIL VISTAMAX → EXXONMOBIL (+ known EXXON aliases). Skip short noise.
  for (const part of base.split(' ')) {
    if (part.length >= 3) tokens.add(part);
  }

  for (const token of [...tokens]) {
    for (const alias of expandKnownProducerAliases(token)) {
      tokens.add(alias);
    }
  }

  return [...tokens];
}

export function buildImportKey(parts: {
  category: string;
  grade: string;
  producer: string;
  filePath: string;
}): string {
  return [
    normalizeMatchToken(parts.category),
    normalizeMatchToken(parts.grade),
    normalizeMatchToken(parts.producer),
    normalizeMatchToken(parts.filePath).replace(/\\/g, '/'),
  ].join('|');
}

export function sanitizeObjectSegment(value: string, fallback = 'unknown'): string {
  const safe = value
    .normalize('NFKC')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return safe || fallback;
}

/**
 * Suggested object key:
 * tds/{category}/{grade}/{producer}/v{revision}/{filename}
 */
export function buildGradeTdsObjectKey(input: {
  category: string;
  grade: string;
  producer: string;
  revision: number;
  filename: string;
}): string {
  const file = sanitizeObjectSegment(
    input.filename.split(/[/\\]/).pop() || 'document.pdf',
    'document.pdf',
  );
  return [
    'tds',
    sanitizeObjectSegment(input.category, 'category'),
    sanitizeObjectSegment(input.grade, 'grade'),
    sanitizeObjectSegment(input.producer, 'producer'),
    `v${Math.max(1, input.revision)}`,
    file,
  ].join('/');
}

/**
 * Inverse of buildGradeTdsObjectKey for R2 → DB reconcile.
 * Returns null when the key is not a TDS library object.
 */
export function parseGradeTdsObjectKey(key: string): {
  category: string;
  grade: string;
  producer: string;
  revision: number;
  filename: string;
} | null {
  const parts = key.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 6) return null;
  if (parts[0]!.toLowerCase() !== 'tds') return null;
  const revisionPart = parts[parts.length - 2]!;
  const revisionMatch = /^v(\d+)$/i.exec(revisionPart);
  if (!revisionMatch) return null;
  const filename = parts[parts.length - 1]!;
  if (!filename || filename.endsWith('/')) return null;
  return {
    category: parts[1]!,
    grade: parts[2]!,
    producer: parts[3]!,
    revision: Math.max(1, Number(revisionMatch[1]) || 1),
    filename,
  };
}

export function classifySourceKind(
  availability: string | null | undefined,
  source: string | null | undefined,
):
  | 'APP'
  | 'WEB'
  | 'WEB_DEALER'
  | 'WEB_MULTI_GRADE'
  | 'WEB_DOUBTFUL'
  | 'IMAGE'
  | 'OTHER'
  | 'UNKNOWN' {
  const a = String(availability ?? '').toLowerCase();
  const s = String(source ?? '').toLowerCase();

  if (!s || s === 'none' || s === 'nan' || a.startsWith('no')) {
    return 'UNKNOWN';
  }
  if (a.includes('image')) return 'IMAGE';
  if (s.includes('doubtful') || a.includes('doubtful')) return 'WEB_DOUBTFUL';
  if (s.includes('multi-grade') || s.includes('group/')) return 'WEB_MULTI_GRADE';
  if (s.includes('dealer')) return 'WEB_DEALER';
  if (s === 'app' || s.startsWith('app ')) return 'APP';
  if (s.startsWith('web')) return 'WEB';
  return 'OTHER';
}

/**
 * Customer-visible only when VERIFIED.
 * Import policy: original app PDFs → VERIFIED; everything else with a file → PENDING_REVIEW;
 * missing → MISSING; unmatched grade → NEEDS_MAPPING (overrides verified).
 */
export function initialVerificationStatus(input: {
  sourceKind: ReturnType<typeof classifySourceKind>;
  hasFile: boolean;
  gradeMatched: boolean;
  ambiguous: boolean;
}): 'PENDING_REVIEW' | 'VERIFIED' | 'NEEDS_MAPPING' | 'MISSING' {
  if (!input.hasFile) return 'MISSING';
  if (input.ambiguous || !input.gradeMatched) return 'NEEDS_MAPPING';
  if (input.sourceKind === 'APP') return 'VERIFIED';
  return 'PENDING_REVIEW';
}

export function mimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

export function isAllowedTdsMime(mime: string): boolean {
  return [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ].includes(mime);
}
