import { describe, expect, it } from 'vitest';
import {
  GRADE_SEARCH_ALIASES,
  buildGradeSearchWhere,
  codeVariants,
  compactKey,
  parseGradeSearch,
  rankGradeCandidates,
  scoreGrade,
  type GradeRankInput,
} from './grade-search.js';

const g = (over: Partial<GradeRankInput> & { id: string }): GradeRankInput => ({
  code: over.id,
  name: over.id,
  ...over,
});

const ids = (rows: GradeRankInput[]) => rows.map((r) => r.id);

describe('query parsing', () => {
  it('returns null for empty / whitespace queries', () => {
    expect(parseGradeSearch('')).toBeNull();
    expect(parseGradeSearch('   ')).toBeNull();
    expect(parseGradeSearch(undefined)).toBeNull();
    expect(buildGradeSearchWhere('  ')).toBeNull();
  });

  it('collapses whitespace and tokenises', () => {
    expect(parseGradeSearch('  HDPE   HM  5 ')).toEqual({
      query: 'HDPE HM 5',
      tokens: ['HDPE', 'HM', '5'],
    });
  });

  it('caps absurd input (length and token count)', () => {
    const parsed = parseGradeSearch('a '.repeat(500));
    expect(parsed!.query.length).toBeLessThanOrEqual(100);
    expect(parsed!.tokens.length).toBeLessThanOrEqual(8);
  });

  it('compactKey makes formatted codes comparable', () => {
    expect(compactKey('F-4811')).toBe('f4811');
    expect(compactKey('f 4811')).toBe('f4811');
    expect(compactKey('TiO₂')).toBe('tio2');
  });

  it('generates separator variants for letter+digit codes', () => {
    expect(codeVariants('F4811')).toEqual(
      expect.arrayContaining(['F4811', 'f-4811', 'f 4811', 'f_4811']),
    );
  });
});

describe('match clause', () => {
  const flat = (w: unknown) => JSON.stringify(w);

  it('requires every token (AND) so multi-word queries narrow results', () => {
    const w = buildGradeSearchWhere('reliance 4811') as {
      AND?: unknown[];
      OR?: unknown[];
    };
    // multi-token queries are OR[ AND(tokens), compact-code fallback ]
    const perToken = (w.OR![0] as { AND: unknown[] }).AND;
    expect(perToken).toHaveLength(2);
  });

  it('partial code "4811" matches code, gradeNo and name', () => {
    const s = flat(buildGradeSearchWhere('4811'));
    expect(s).toContain('"gradeNo":{"contains":"4811"');
    expect(s).toContain('"code":{"contains":"4811"');
    expect(s).toContain('"name":{"contains":"4811"');
  });

  it('"F4811" also tries formatted variants such as F-4811', () => {
    expect(flat(buildGradeSearchWhere('F4811'))).toContain('f-4811');
  });

  it('TiO2 / TIO / titanium dioxide share the same expansion', () => {
    for (const q of ['TiO2', 'TIO', 'tio', 'titanium dioxide']) {
      const s = flat(buildGradeSearchWhere(q));
      expect(s, q).toContain('titanium dioxide');
      expect(s, q).toContain('TiO2');
    }
  });

  it('bare "tio" is never a contains term (STYROLUTION false positive)', () => {
    const s = flat(buildGradeSearchWhere('tio'));
    expect(s).not.toContain('"contains":"tio"');
    expect(s).not.toContain('"contains":"TIO"');
    expect(s).toContain('"startsWith":"TIO"');
  });

  it('bare "pp" is prefix-only, not contains', () => {
    const s = flat(buildGradeSearchWhere('pp'));
    expect(s).not.toContain('"contains":"pp"');
    expect(s).not.toContain('"contains":"PP"');
    expect(s).toContain('"startsWith":"PP"');
  });

  it('searches manufacturer, category, description and application', () => {
    const s = flat(buildGradeSearchWhere('reliance'));
    expect(s).toContain('"manufacturer":{"contains":"reliance"');
    expect(s).toContain('"category":{"name"');
    expect(s).toContain('"description":{"contains":"reliance"');
    expect(s).toContain('"gradeApplications"');
  });

  it('single character queries are prefix-only (no table-wide contains)', () => {
    const s = flat(buildGradeSearchWhere('f'));
    expect(s).not.toContain('"contains"');
    expect(s).toContain('startsWith');
  });

  it('alias triggers never collide', () => {
    const seen = new Set<string>();
    for (const grp of GRADE_SEARCH_ALIASES) {
      for (const t of grp.triggers) {
        expect(seen.has(t), t).toBe(false);
        seen.add(t);
      }
    }
  });
});

describe('ranking', () => {
  it('exact code > code prefix > name > manufacturer > category > description', () => {
    const exactCode = g({ id: 'exact', code: 'F4811', name: 'Unrelated' });
    const codePrefix = g({
      id: 'codePrefix',
      code: 'F4811X',
      name: 'Unrelated',
    });
    const name = g({ id: 'name', code: 'ZZ1', name: 'Series F4811 resin' });
    const mfr = g({
      id: 'mfr',
      code: 'ZZ2',
      name: 'Other',
      manufacturer: 'F4811 Industries',
    });
    const cat = g({
      id: 'cat',
      code: 'ZZ3',
      name: 'Other3',
      category: { code: 'X', name: 'F4811 family' },
    });
    const desc = g({
      id: 'desc',
      code: 'ZZ4',
      name: 'Other4',
      description: 'works like F4811',
    });

    const ranked = rankGradeCandidates(
      [desc, cat, mfr, name, codePrefix, exactCode],
      'F4811',
    );
    expect(ids(ranked)).toEqual([
      'exact',
      'codePrefix',
      'name',
      'mfr',
      'cat',
      'desc',
    ]);
  });

  it('partial numeric code finds F4811 and ranks it above description-only hits', () => {
    const hit = g({
      id: 'hit',
      code: 'F4811',
      gradeNo: 'F4811',
      name: 'F4811',
    });
    const noise = g({
      id: 'noise',
      code: 'A1',
      name: 'A1',
      description: 'similar to 4811',
    });
    expect(scoreGrade(hit, '4811')).toBeGreaterThan(scoreGrade(noise, '4811'));
    expect(ids(rankGradeCandidates([noise, hit], '4811'))[0]).toBe('hit');
  });

  it('matches regardless of separators (F-4811 vs F4811)', () => {
    const dashed = g({ id: 'd', code: 'F-4811', name: 'F-4811' });
    expect(scoreGrade(dashed, 'F4811')).toBeGreaterThanOrEqual(1000);
    expect(scoreGrade(dashed, 'f 4811')).toBeGreaterThan(0);
  });

  it('is case-insensitive and unaffected by repeated whitespace', () => {
    const grade = g({
      id: 'x',
      code: 'HM5010',
      name: 'HDPE HM5010',
      manufacturer: 'Reliance',
    });
    expect(scoreGrade(grade, 'RELIANCE')).toBe(
      scoreGrade(grade, '  reliance '),
    );
  });

  it('TiO2 synonyms rank a TiO2 grade and ignore a STYROLUTION grade', () => {
    const tio = g({
      id: 'tio',
      code: 'R-902',
      name: 'TiO2 R-902',
      description: 'Titanium dioxide pigment',
    });
    const styro = g({
      id: 'styro',
      code: 'S1',
      name: 'S1',
      manufacturer: 'INEOS STYROLUTION',
    });
    for (const q of ['tio', 'tio2', 'TiO₂', 'titanium dioxide']) {
      expect(scoreGrade(tio, q), q).toBeGreaterThan(0);
      expect(scoreGrade(styro, q), q).toBe(0);
    }
  });

  it('multi-token queries need every token to score', () => {
    const grade = g({
      id: 'a',
      code: 'A1',
      name: 'A1',
      manufacturer: 'Reliance',
    });
    expect(scoreGrade(grade, 'reliance')).toBeGreaterThan(0);
    // second token matches nothing: total still counts token 1 but loses to a full match
    const full = g({
      id: 'b',
      code: 'B1',
      name: 'B1',
      manufacturer: 'Reliance',
      description: 'injection molding',
    });
    expect(scoreGrade(full, 'reliance injection')).toBeGreaterThan(
      scoreGrade(grade, 'reliance injection'),
    );
  });

  it('is deterministic: ties break on sortOrder, then name, then id', () => {
    const a = g({
      id: 'a',
      code: 'K1',
      name: 'Alpha',
      sortOrder: 2,
      manufacturer: 'Acme',
    });
    const b = g({
      id: 'b',
      code: 'K2',
      name: 'Beta',
      sortOrder: 1,
      manufacturer: 'Acme',
    });
    const c = g({
      id: 'c',
      code: 'K3',
      name: 'Alpha',
      sortOrder: 1,
      manufacturer: 'Acme',
    });
    const first = ids(rankGradeCandidates([a, b, c], 'acme'));
    const second = ids(rankGradeCandidates([c, a, b], 'acme'));
    expect(first).toEqual(second);
    expect(first).toEqual(['c', 'b', 'a']);
  });
});
