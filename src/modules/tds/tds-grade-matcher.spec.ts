import { describe, expect, it } from 'vitest';
import {
  matchGradeFromIndex,
  type GradeMatchCandidate,
} from './tds-grade-matcher.js';
import {
  normalizeMatchToken,
  producerAliasTokens,
  producerBaseName,
} from './tds-normalize.js';

function buildIndex(grades: GradeMatchCandidate[]) {
  const byGradeProducer = new Map<string, GradeMatchCandidate[]>();
  const byGradeOnly = new Map<string, GradeMatchCandidate[]>();

  for (const g of grades) {
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
    const baseKey = `${gn}||${producerBaseName(g.manufacturer ?? '')}`;
    if (!byGradeProducer.has(baseKey)) {
      byGradeProducer.set(baseKey, byGradeProducer.get(baseKey) ?? [g]);
    }
  }

  return { byGradeProducer, byGradeOnly, all: grades };
}

describe('matchGradeFromIndex producer aliases', () => {
  const exxon6202: GradeMatchCandidate = {
    id: 'grade-6202',
    code: 'SO-PP-6202-EXXON-CEE886',
    name: 'PP VISTAMAX 6202 - EXXON',
    gradeNo: '6202',
    gradeGroup: 'VISTAMAX',
    manufacturer: 'EXXON',
    categoryCode: 'PP',
    subcategoryCode: null,
  };

  it('matches R2 producer EXXONMOBIL_VISTAMAX to catalogue manufacturer EXXON', () => {
    const index = buildIndex([exxon6202]);
    const result = matchGradeFromIndex(index, {
      category: 'VISTAMAX',
      grade: '6202',
      producer: 'EXXONMOBIL_VISTAMAX',
    });
    expect(result.gradeId).toBe('grade-6202');
    expect(result.confidence).toBe('exact');
  });

  it('still refuses grade-number-only attach when producers differ', () => {
    const index = buildIndex([exxon6202]);
    const result = matchGradeFromIndex(index, {
      category: 'VISTAMAX',
      grade: '6202',
      producer: 'DOW',
    });
    expect(result.gradeId).toBeNull();
    expect(result.reason).toMatch(/No producer match/);
  });
});
