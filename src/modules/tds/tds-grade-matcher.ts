import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  normalizeMatchToken,
  producerAliasTokens,
  producerBaseName,
} from './tds-normalize.js';

export type GradeMatchCandidate = {
  id: string;
  code: string;
  name: string;
  gradeNo: string | null;
  gradeGroup: string | null;
  manufacturer: string | null;
  categoryCode: string | null;
  subcategoryCode: string | null;
};

export type GradeMatchResult = {
  gradeId: string | null;
  confidence: 'exact' | 'strong' | 'weak' | 'none' | 'ambiguous';
  candidates: GradeMatchCandidate[];
  reason: string;
};

type IndexMaps = {
  byGradeProducer: Map<string, GradeMatchCandidate[]>;
  byGradeOnly: Map<string, GradeMatchCandidate[]>;
  all: GradeMatchCandidate[];
};

function gradeKey(gradeNo: string, producer: string): string {
  return `${normalizeMatchToken(gradeNo)}||${producerBaseName(producer)}`;
}

export async function loadGradeMatchIndex(
  prisma: PrismaClient,
): Promise<IndexMaps> {
  const grades = await prisma.grade.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      gradeNo: true,
      gradeGroup: true,
      manufacturer: true,
      category: { select: { code: true } },
      subcategory: { select: { code: true } },
    },
  });

  const all: GradeMatchCandidate[] = grades.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    gradeNo: g.gradeNo,
    gradeGroup: g.gradeGroup,
    manufacturer: g.manufacturer,
    categoryCode: g.category?.code ?? null,
    subcategoryCode: g.subcategory?.code ?? null,
  }));

  const byGradeProducer = new Map<string, GradeMatchCandidate[]>();
  const byGradeOnly = new Map<string, GradeMatchCandidate[]>();

  for (const g of all) {
    const gn = normalizeMatchToken(g.gradeNo || g.name);
    if (!gn) continue;
    const listOnly = byGradeOnly.get(gn) ?? [];
    listOnly.push(g);
    byGradeOnly.set(gn, listOnly);

    for (const alias of producerAliasTokens(g.manufacturer)) {
      const key = `${gn}||${alias}`;
      const list = byGradeProducer.get(key) ?? [];
      list.push(g);
      byGradeProducer.set(key, list);
    }
    // Also index by base producer
    const baseKey = gradeKey(gn, g.manufacturer ?? '');
    if (!byGradeProducer.has(baseKey)) {
      byGradeProducer.set(baseKey, byGradeProducer.get(baseKey) ?? [g]);
    }
  }

  return { byGradeProducer, byGradeOnly, all };
}

function categoryCompatible(
  candidate: GradeMatchCandidate,
  excelCategory: string,
): boolean {
  const cat = normalizeMatchToken(excelCategory);
  if (!cat) return true;
  const group = normalizeMatchToken(candidate.gradeGroup);
  const sub = normalizeMatchToken(candidate.subcategoryCode);
  const top = normalizeMatchToken(candidate.categoryCode);
  // Excel Category often equals subcategory code (ABS_EXTRUSION) or chip slug.
  if (sub && sub === cat) return true;
  if (group && group === cat) return true;
  if (top && (top === cat || cat.startsWith(top) || top.startsWith(cat.split(' ')[0]!))) {
    return true;
  }
  // Underscore vs space already normalized; also allow fuzzy contains for group
  if (group && (group.includes(cat) || cat.includes(group))) return true;
  if (sub && (sub.includes(cat) || cat.includes(sub))) return true;
  return false;
}

export function matchGradeFromIndex(
  index: IndexMaps,
  input: { category: string; grade: string; producer: string },
): GradeMatchResult {
  const gradeNo = normalizeMatchToken(input.grade);
  if (!gradeNo) {
    return {
      gradeId: null,
      confidence: 'none',
      candidates: [],
      reason: 'Empty grade code',
    };
  }

  const producerTokens = producerAliasTokens(input.producer);
  const hits = new Map<string, GradeMatchCandidate>();

  for (const token of producerTokens) {
    const key = `${gradeNo}||${token}`;
    for (const c of index.byGradeProducer.get(key) ?? []) {
      hits.set(c.id, c);
    }
  }

  let candidates = [...hits.values()];
  if (candidates.length === 0) {
    // Do NOT auto-attach on grade-number-only matches.
    const gradeOnly = index.byGradeOnly.get(gradeNo) ?? [];
    if (gradeOnly.length === 1 && !input.producer.trim()) {
      return {
        gradeId: gradeOnly[0]!.id,
        confidence: 'weak',
        candidates: gradeOnly,
        reason: 'Single gradeNo match with empty producer',
      };
    }
    return {
      gradeId: null,
      confidence: gradeOnly.length ? 'none' : 'none',
      candidates: gradeOnly.slice(0, 5),
      reason: gradeOnly.length
        ? `No producer match for gradeNo=${gradeNo}; refusing grade-number-only attach (${gradeOnly.length} candidates)`
        : `No grade found for gradeNo=${gradeNo}`,
    };
  }

  const withCategory = candidates.filter((c) =>
    categoryCompatible(c, input.category),
  );
  if (withCategory.length === 1) {
    return {
      gradeId: withCategory[0]!.id,
      confidence: 'exact',
      candidates: withCategory,
      reason: 'Exact gradeNo + producer + category',
    };
  }
  if (withCategory.length > 1) {
    return {
      gradeId: null,
      confidence: 'ambiguous',
      candidates: withCategory.slice(0, 8),
      reason: 'Multiple grades match gradeNo + producer + category',
    };
  }

  // Category didn't narrow; if single producer+grade hit, accept as strong.
  if (candidates.length === 1) {
    return {
      gradeId: candidates[0]!.id,
      confidence: 'strong',
      candidates,
      reason: 'Exact gradeNo + producer (category unmatched)',
    };
  }

  return {
    gradeId: null,
    confidence: 'ambiguous',
    candidates: candidates.slice(0, 8),
    reason: 'Multiple grades match gradeNo + producer',
  };
}
