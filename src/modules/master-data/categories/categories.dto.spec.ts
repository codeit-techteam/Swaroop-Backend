import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateCategoryDto } from './categories.dto.js';
import { classifyCategory } from '../../../../scripts/report-category-labels.js';

const errs = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateCategoryDto, body))).map(
    (e) => e.property,
  );

describe('category displayName validation', () => {
  it('accepts a readable name', async () => {
    expect(await errs({ displayName: 'Polypropylene Copolymer' })).toEqual([]);
  });
  it('rejects underscores (raw master codes)', async () => {
    expect(await errs({ displayName: 'PP_CP' })).toEqual(['displayName']);
  });
  it('rejects a raw ID', async () => {
    expect(
      await errs({ displayName: '3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab' }),
    ).toEqual(['displayName']);
  });
});

describe('category label audit', () => {
  const base = {
    id: '1',
    parentGroup: 'POLYMERS',
    isActive: true,
    grades: 3,
  };
  it('flags auto-derived labels as needing confirmation, never as final', () => {
    const r = classifyCategory({
      ...base,
      code: 'PP_CP',
      name: 'PP_CP',
      displayName: null,
    });
    expect(r.customerSees).not.toContain('_');
    expect(r.source).toBe('AUTO_DERIVED');
    expect(r.needsClientConfirmation).toBe(true);
  });
  it('marks an explicit displayName as EXPLICIT', () => {
    const r = classifyCategory({
      ...base,
      code: 'PP_CP',
      name: 'PP_CP',
      displayName: 'Polypropylene Copolymer',
    });
    expect(r.source).toBe('EXPLICIT');
    expect(r.issues).toEqual([]);
  });
  it('reports labels that would still show an underscore', () => {
    const r = classifyCategory({
      ...base,
      code: 'X',
      name: 'X',
      displayName: 'Bad_Label',
    });
    // the display formatter humanises it, but the stored value is the issue to fix
    expect(r.storedDisplayName).toBe('Bad_Label');
  });
});
