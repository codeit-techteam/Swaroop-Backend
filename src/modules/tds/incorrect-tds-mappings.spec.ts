import { describe, expect, it } from 'vitest';
import { isKnownIncorrectTdsMapping } from './incorrect-tds-mappings.js';

describe('isKnownIncorrectTdsMapping', () => {
  it('rejects the SR101 sheet on ABS EXTRUSION 3000D', () => {
    expect(
      isKnownIncorrectTdsMapping({
        originalFilename: 'ABS_EXTRUSION_SR101_TDS.pdf',
        gradeName: '3000D',
        fullGradeName: 'ABS EXTRUSION 3000D',
        gradeCode: 'SO-ABS-3000D-PRIVATE-DD7728',
      }),
    ).toBe(true);
  });

  it('keeps the same file when the grade itself is SR101', () => {
    expect(
      isKnownIncorrectTdsMapping({
        originalFilename: 'ABS_EXTRUSION_SR101_TDS.pdf',
        gradeName: 'SR101',
        fullGradeName: 'ABS EXTRUSION SR101',
        gradeCode: 'SO-ABS-SR101-PRIVATE-AAAA',
      }),
    ).toBe(false);
  });

  it('does not hide an unrelated document', () => {
    expect(
      isKnownIncorrectTdsMapping({
        originalFilename: 'HDPE_F46003_TDS.pdf',
        gradeName: 'F46003',
        fullGradeName: 'HDPE FILM F46003',
      }),
    ).toBe(false);
  });
});
