import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_SOURCE_ONE_CSV } from './source-one-files.js';
import {
  displayNameOf,
  gradeCodeOf,
  masterCode,
  parseCsv,
  planSourceOneImport,
  SOURCE_ONE_HEADERS,
  SourceOneCsvError,
  sourceKeyOf,
} from './source-one-csv.js';

const HEADER = SOURCE_ONE_HEADERS.join(',');
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('\uFEFFa,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a,"b')).toThrow(SourceOneCsvError);
  });
});

describe('codes and labels', () => {
  it('derives stable master codes', () => {
    expect(masterCode(' PP CP ')).toBe('PP_CP');
    expect(masterCode('rLLDPE')).toBe('RLLDPE');
  });

  it('matches grades case-insensitively on all four identity columns', () => {
    const a = {
      category: 'r',
      gradeGroup: 'rPET',
      gradeNo: 'rP080EAB',
      manufacturer: 'Source re',
    };
    const b = { ...a, manufacturer: 'SOURCE RE' };
    expect(sourceKeyOf(a)).toBe(sourceKeyOf(b));
    expect(sourceKeyOf({ ...a, manufacturer: null })).not.toBe(sourceKeyOf(a));
  });

  it('builds a readable display name when Source.One has no full name', () => {
    const row = {
      gradeGroup: 'HD Film',
      gradeNo: 'F46003',
      manufacturer: 'Reliance',
      fullGradeName: null,
    };
    expect(displayNameOf(row)).toBe('HD Film F46003 - Reliance');
    expect(displayNameOf({ ...row, manufacturer: null })).toBe(
      'HD Film F46003',
    );
    expect(displayNameOf({ ...row, fullGradeName: 'Relene F46003' })).toBe(
      'Relene F46003',
    );
  });
});

describe('planSourceOneImport', () => {
  it('rejects files with missing or unexpected columns', () => {
    expect(() => planSourceOneImport('Category,Grade\nPP,1')).toThrow(
      /Missing columns/,
    );
    expect(() => planSourceOneImport(`${HEADER},Extra\n`)).toThrow(
      /Unexpected columns: Extra/,
    );
  });

  it('reports invalid rows with line numbers instead of guessing values', () => {
    const plan = planSourceOneImport(
      csv(
        'PP,PP Raffia,H110MA,Reliance,,No,,,',
        ',PP Raffia,H030SG,Reliance,,No,,,',
        'PP,PP Raffia,H030SG,Reliance,,Maybe,,,',
        'PP,PP Raffia,H350FG,Reliance,,Yes,12.345,,',
        'PP,PP Raffia,H200MA,Reliance',
      ),
    );
    expect(plan.totalRows).toBe(5);
    expect(plan.validRows).toBe(1);
    expect(plan.invalid.map((i) => [i.line, i.field ?? 'row'])).toEqual([
      [3, 'Category'],
      [4, "In Today's Delhi Price List"],
      [5, 'Price Today (Rs/kg)'],
      [6, 'row'],
      [6, "In Today's Delhi Price List"],
    ]);
  });

  it('merges duplicates, keeping the priced Delhi-list row and every line number', () => {
    const plan = planSourceOneImport(
      csv(
        'HDPE,HD Film,F46003,Reliance,,No,,,',
        'HDPE,HD Film,F46003,RELIANCE,Relene F46003,Yes,112.50,110.00,Ex-Depot',
        'HDPE,HD Film,F46003,Reliance,,No,,,',
      ),
    );
    expect(plan.grades).toHaveLength(1);
    const [grade] = plan.grades;
    expect(grade.line).toBe(3);
    expect(grade.lines).toEqual([2, 3, 4]);
    expect(grade.priceTodayRsKg).toBe('112.50');
    expect(grade.inTodaysDelhiPriceList).toBe(true);
    expect(plan.duplicates).toEqual([
      expect.objectContaining({
        keptLine: 3,
        mergedLines: [2, 4],
        identical: false,
      }),
    ]);
  });

  it('keeps blank manufacturers as NULL with a warning', () => {
    const plan = planSourceOneImport(csv('PVC,PVC Resin,K67,,,No,,,'));
    expect(plan.grades[0].manufacturer).toBeNull();
    expect(plan.warnings).toEqual([
      expect.objectContaining({ line: 2, field: 'Manufacturer' }),
    ]);
  });

  describe('bundled Source.One master', () => {
    const plan = planSourceOneImport(
      readFileSync(join(process.cwd(), BUNDLED_SOURCE_ONE_CSV), 'utf8'),
    );

    it('imports every row without inventing or dropping grades', () => {
      expect(plan.totalRows).toBe(3677);
      expect(plan.validRows).toBe(3677);
      expect(plan.invalid).toEqual([]);
      expect(plan.grades).toHaveLength(3666);
      expect(plan.duplicates).toHaveLength(11);
      expect(
        plan.duplicates.reduce((n, d) => n + d.mergedLines.length, 0),
      ).toBe(11);
      expect(plan.categories).toHaveLength(61);
    });

    it('separates the 2 exact copies from the 9 same-key rows with differing values', () => {
      expect(plan.exactDuplicateRows).toBe(2);
      expect(plan.duplicates.filter((d) => d.identical)).toEqual([
        expect.objectContaining({ keptLine: 2602, mergedLines: [2603] }),
        expect.objectContaining({ keptLine: 3574, mergedLines: [3575] }),
      ]);
      expect(plan.duplicates.filter((d) => !d.identical)).toHaveLength(9);
    });

    it('keeps the priced row when a grade is listed both priced and unpriced', () => {
      const tasnee = plan.grades.find(
        (g) => g.gradeNo === '4025AS' && g.manufacturer === 'TASNEE',
      );
      expect(tasnee).toMatchObject({
        lines: [1288, 1289],
        fullGradeName: 'LDPE SLIP 4025AS - TASNEE',
        inTodaysDelhiPriceList: true,
        priceTodayRsKg: '181.67',
        producerPriceRsKg: null,
      });
    });

    it('generates unique, deterministic grade codes', () => {
      const codes = plan.grades.map((g) => g.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(plan.grades.map((g) => gradeCodeOf(g))).toEqual(codes);
    });

    it('stores prices with at most two decimals', () => {
      for (const g of plan.grades) {
        for (const price of [g.priceTodayRsKg, g.producerPriceRsKg]) {
          if (price != null) expect(price).toMatch(/^\d+(\.\d{1,2})?$/);
        }
      }
      expect(
        plan.grades.filter((g) => g.inTodaysDelhiPriceList).length,
      ).toBeGreaterThan(0);
    });
  });
});
