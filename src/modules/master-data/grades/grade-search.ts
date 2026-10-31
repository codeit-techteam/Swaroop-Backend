import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * Catalogue grade search: normalisation, tokenisation, aliases, partial codes
 * and relevance ranking.
 *
 * Matching is done in the database (AND across tokens, OR across fields) so it
 * works for the whole catalogue. Prisma cannot order by relevance, so ranking is
 * computed here over the matched candidates (see `rankGradeCandidates`).
 *
 * Ranking tiers (highest first), per product requirements:
 *   1. exact grade code / grade number / grade name
 *   2. grade code / number partial (prefix, then contains)
 *   3. product (grade) name
 *   4. manufacturer
 *   5. material / category / grade group
 *   6. description / application
 */

/** Hard cap on how many matched candidates are ranked in memory. */
export const GRADE_SEARCH_CANDIDATE_CAP = 1000;
const MAX_TOKENS = 8;
const MAX_QUERY_LENGTH = 100;

export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/₂/g, '2')
    .replace(/₃/g, '3')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-case alphanumerics only — makes "F-4811", "f 4811" and "F4811" comparable. */
export function compactKey(input: string): string {
  return normalizeSearchText(input).replace(/[^a-z0-9]+/g, '');
}

interface AliasGroup {
  /** compact keys that trigger the group (whole token or whole query). */
  triggers: string[];
  /** Unambiguous terms — safe for `contains` on every searchable field. */
  terms: string[];
  /** Short abbreviations — only matched as a prefix on identity/category fields. */
  prefixes: string[];
}

/**
 * Chemical / material aliases. Bare short forms (e.g. "tio", "pp") must never be a
 * `contains` term: "tio" matches STYROLUTION / SOLUTION, "pp" matches half the catalogue.
 */
export const GRADE_SEARCH_ALIASES: AliasGroup[] = [
  {
    triggers: ['tio', 'tio2', 'titaniumdioxide'],
    terms: ['TiO2', 'titanium dioxide'],
    prefixes: ['TIO'],
  },
  {
    triggers: ['caco3', 'calciumcarbonate'],
    terms: ['CaCO3', 'calcium carbonate'],
    prefixes: ['CACO'],
  },
  {
    triggers: ['hdpe', 'highdensitypolyethylene'],
    terms: ['HDPE', 'high density polyethylene'],
    prefixes: [],
  },
  {
    triggers: ['ldpe', 'lowdensitypolyethylene'],
    terms: ['LDPE', 'low density polyethylene'],
    prefixes: [],
  },
  {
    triggers: ['lldpe', 'linearlowdensitypolyethylene'],
    terms: ['LLDPE', 'linear low density polyethylene'],
    prefixes: [],
  },
  {
    triggers: ['pp', 'polypropylene'],
    terms: ['polypropylene'],
    prefixes: ['PP'],
  },
  {
    triggers: ['pvc', 'polyvinylchloride'],
    terms: ['PVC', 'polyvinyl chloride'],
    prefixes: [],
  },
  {
    triggers: ['pet', 'polyethyleneterephthalate'],
    terms: ['polyethylene terephthalate'],
    prefixes: ['PET'],
  },
  {
    triggers: ['abs', 'acrylonitrilebutadienestyrene'],
    terms: ['acrylonitrile butadiene styrene'],
    prefixes: ['ABS'],
  },
  {
    triggers: ['masterbatch', 'mb'],
    terms: ['masterbatch', 'master batch'],
    prefixes: ['MB'],
  },
];

function aliasFor(token: string): AliasGroup | undefined {
  const key = compactKey(token);
  return GRADE_SEARCH_ALIASES.find((g) => g.triggers.includes(key));
}

export interface ParsedGradeSearch {
  /** Normalised query as typed (whitespace collapsed). */
  query: string;
  tokens: string[];
}

export function parseGradeSearch(
  raw: string | null | undefined,
): ParsedGradeSearch | null {
  if (!raw) return null;
  const query = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return null;
  // Multi-word aliases ("titanium dioxide") must be recognised as a whole phrase.
  if (aliasFor(query)) return { query, tokens: [query] };
  const tokens = query.split(' ').filter(Boolean).slice(0, MAX_TOKENS);
  return tokens.length ? { query, tokens } : null;
}

/** "F4811" → also try "F-4811", "F 4811", "F_4811" so formatted codes still match. */
export function codeVariants(token: string): string[] {
  const out = new Set<string>([token]);
  const compact = compactKey(token);
  if (compact.length >= 3) out.add(compact);
  const m = /^([a-z]+)(\d+)$/i.exec(compact);
  if (m) {
    out.add(`${m[1]}-${m[2]}`);
    out.add(`${m[1]} ${m[2]}`);
    out.add(`${m[1]}_${m[2]}`);
  }
  return [...out];
}

const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
const prefix = (v: string) => ({ startsWith: v, mode: 'insensitive' as const });

function identityFields(
  op: (v: string) => Prisma.StringFilter,
  v: string,
): Prisma.GradeWhereInput[] {
  return [
    { gradeNo: op(v) },
    { code: op(v) },
    { name: op(v) },
    { displayName: op(v) },
    { fullGradeName: op(v) },
  ];
}

function allFieldContains(v: string): Prisma.GradeWhereInput[] {
  const f = contains(v);
  return [
    ...identityFields(contains, v),
    { manufacturer: f },
    { gradeGroup: f },
    { description: f },
    { category: { code: f } },
    { category: { name: f } },
    { category: { displayName: f } },
    {
      gradeApplications: {
        some: { application: { OR: [{ name: f }, { displayName: f }] } },
      },
    },
  ];
}

function tokenClause(token: string): Prisma.GradeWhereInput {
  const alias = aliasFor(token);
  const or: Prisma.GradeWhereInput[] = [];

  if (alias) {
    for (const t of alias.terms) or.push(...allFieldContains(t));
    for (const p of alias.prefixes) {
      or.push(
        ...identityFields(prefix, p),
        { gradeGroup: prefix(p) },
        { category: { code: prefix(p) } },
      );
    }
    return { OR: or };
  }

  if (token.length < 2) {
    // A single character is only meaningful as the start of a code / name.
    or.push(...identityFields(prefix, token), { manufacturer: prefix(token) });
    return { OR: or };
  }

  for (const variant of codeVariants(token)) {
    or.push(...allFieldContains(variant));
  }
  return { OR: or };
}

/**
 * Prisma filter for a search query, or `null` when the query is empty.
 * Every token must match (AND); a token may match any field or alias (OR).
 * A joined compact form is also tried so "F 4811" finds "F4811".
 */
export function buildGradeSearchWhere(
  raw: string | null | undefined,
): Prisma.GradeWhereInput | null {
  const parsed = parseGradeSearch(raw);
  if (!parsed) return null;

  const perToken: Prisma.GradeWhereInput = {
    AND: parsed.tokens.map(tokenClause),
  };

  const joined = compactKey(parsed.query);
  if (parsed.tokens.length > 1 && joined.length >= 3) {
    return {
      OR: [perToken, { OR: identityFields(contains, joined) }],
    };
  }
  return perToken;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface GradeRankInput {
  id: string;
  code: string;
  gradeNo?: string | null;
  name: string;
  displayName?: string | null;
  fullGradeName?: string | null;
  manufacturer?: string | null;
  gradeGroup?: string | null;
  description?: string | null;
  sortOrder?: number | null;
  category?: {
    code?: string | null;
    name?: string | null;
    displayName?: string | null;
  } | null;
  gradeApplications?: Array<{
    application?: { name?: string | null; displayName?: string | null } | null;
  }> | null;
}

export const RANK = {
  EXACT_IDENTITY: 1000,
  CODE_PREFIX: 800,
  CODE_CONTAINS: 600,
  NAME_PREFIX: 500,
  NAME_CONTAINS: 400,
  MANUFACTURER: 300,
  CATEGORY: 200,
  DESCRIPTION: 100,
} as const;

function fieldScore(
  value: string | null | undefined,
  term: string,
  scores: { exact: number; prefix: number; contains: number },
  compare: 'compact' | 'text',
): number {
  if (!value) return 0;
  const hay =
    compare === 'compact' ? compactKey(value) : normalizeSearchText(value);
  const needle =
    compare === 'compact' ? compactKey(term) : normalizeSearchText(term);
  if (!needle) return 0;
  if (hay === needle) return scores.exact;
  if (hay.startsWith(needle)) return scores.prefix;
  if (hay.includes(needle)) return scores.contains;
  return 0;
}

/** Best score of one search term (token or alias expansion) across every field. */
function termScore(g: GradeRankInput, term: string): number {
  const codeScores = {
    exact: RANK.EXACT_IDENTITY,
    prefix: RANK.CODE_PREFIX,
    contains: RANK.CODE_CONTAINS,
  };
  const nameScores = {
    exact: RANK.EXACT_IDENTITY,
    prefix: RANK.NAME_PREFIX,
    contains: RANK.NAME_CONTAINS,
  };
  const mfr = {
    exact: RANK.MANUFACTURER,
    prefix: RANK.MANUFACTURER,
    contains: RANK.MANUFACTURER - 25,
  };
  const cat = {
    exact: RANK.CATEGORY,
    prefix: RANK.CATEGORY,
    contains: RANK.CATEGORY - 25,
  };
  const desc = {
    exact: RANK.DESCRIPTION,
    prefix: RANK.DESCRIPTION,
    contains: RANK.DESCRIPTION - 10,
  };

  let best = 0;
  const consider = (n: number) => {
    if (n > best) best = n;
  };

  consider(fieldScore(g.code, term, codeScores, 'compact'));
  consider(fieldScore(g.gradeNo, term, codeScores, 'compact'));
  consider(fieldScore(g.name, term, nameScores, 'compact'));
  consider(fieldScore(g.displayName, term, nameScores, 'compact'));
  consider(fieldScore(g.fullGradeName, term, nameScores, 'text'));
  consider(fieldScore(g.manufacturer, term, mfr, 'text'));
  consider(fieldScore(g.gradeGroup, term, cat, 'text'));
  consider(fieldScore(g.category?.code, term, cat, 'text'));
  consider(fieldScore(g.category?.name, term, cat, 'text'));
  consider(fieldScore(g.category?.displayName, term, cat, 'text'));
  consider(fieldScore(g.description, term, desc, 'text'));
  for (const ga of g.gradeApplications ?? []) {
    consider(fieldScore(ga.application?.name, term, desc, 'text'));
    consider(fieldScore(ga.application?.displayName, term, desc, 'text'));
  }
  return best;
}

/** Alias abbreviations only count as a prefix of identity/category fields. */
function prefixOnlyScore(g: GradeRankInput, p: string): number {
  const needle = compactKey(p);
  const starts = (v?: string | null) => !!v && compactKey(v).startsWith(needle);
  if ([g.code, g.gradeNo, g.name, g.displayName].some(starts))
    return RANK.CODE_PREFIX;
  if (starts(g.fullGradeName)) return RANK.NAME_PREFIX;
  if ([g.gradeGroup, g.category?.code].some(starts)) return RANK.CATEGORY;
  return 0;
}

function tokenScore(g: GradeRankInput, token: string): number {
  const alias = aliasFor(token);
  let best = 0;
  if (alias) {
    for (const t of alias.terms) best = Math.max(best, termScore(g, t));
    for (const p of alias.prefixes)
      best = Math.max(best, prefixOnlyScore(g, p));
    return best;
  }
  for (const t of codeVariants(token)) best = Math.max(best, termScore(g, t));
  return best;
}

export function scoreGrade(g: GradeRankInput, raw: string): number {
  const parsed = parseGradeSearch(raw);
  if (!parsed) return 0;
  let total = 0;
  for (const token of parsed.tokens) total += tokenScore(g, token);
  // Whole-query bonus: "HDPE HM 5" typed exactly as a code/name outranks token soup.
  if (parsed.tokens.length > 1) {
    total = Math.max(total, termScore(g, parsed.query) + 50);
  }
  return total;
}

/**
 * Sort candidates best-first. Ties break on curated sortOrder, then name, then id
 * so pagination is stable across requests.
 */
export function rankGradeCandidates<T extends GradeRankInput>(
  candidates: T[],
  raw: string,
): T[] {
  return candidates
    .map((c) => ({ c, s: scoreGrade(c, raw) }))
    .sort(
      (a, b) =>
        b.s - a.s ||
        (a.c.sortOrder ?? 0) - (b.c.sortOrder ?? 0) ||
        (a.c.displayName ?? a.c.name).localeCompare(
          b.c.displayName ?? b.c.name,
        ) ||
        a.c.id.localeCompare(b.c.id),
    )
    .map((x) => x.c);
}
