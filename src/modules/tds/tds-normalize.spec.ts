import { describe, expect, it } from 'vitest';
import {
  buildGradeTdsObjectKey,
  buildImportKey,
  classifySourceKind,
  initialVerificationStatus,
  normalizeMatchToken,
  parseGradeTdsObjectKey,
  producerBaseName,
} from './tds-normalize.js';

describe('tds-normalize', () => {
  it('normalizes case, spaces, underscores and hyphens for matching only', () => {
    expect(normalizeMatchToken('  PC_MOULD__10-16  ')).toBe('PC MOULD 10 16');
  });

  it('strips producer parenthetical aliases', () => {
    expect(producerBaseName('SABIC (PE100)')).toBe('SABIC');
  });

  it('builds stable import keys', () => {
    expect(
      buildImportKey({
        category: 'ABS_EXTRUSION',
        grade: 'SR101',
        producer: 'IRPC',
        filePath: 'ABS_EXTRUSION/ABS_EXTRUSION_SR101_TDS.pdf',
      }),
    ).toContain('SR101');
  });

  it('round-trips grade TDS object keys used by R2 sync', () => {
    const key = buildGradeTdsObjectKey({
      category: 'ABS_EXTRUSION',
      grade: 'RS670',
      producer: 'LG',
      revision: 1,
      filename: 'ABS_EXTRUSION_RS670_TDS.pdf',
    });
    expect(key).toBe(
      'tds/ABS_EXTRUSION/RS670/LG/v1/ABS_EXTRUSION_RS670_TDS.pdf',
    );
    expect(parseGradeTdsObjectKey(key)).toEqual({
      category: 'ABS_EXTRUSION',
      grade: 'RS670',
      producer: 'LG',
      revision: 1,
      filename: 'ABS_EXTRUSION_RS670_TDS.pdf',
    });
    expect(parseGradeTdsObjectKey('other/path.pdf')).toBeNull();
  });

  it('classifies provenance kinds', () => {
    expect(classifySourceKind('yes', 'app')).toBe('APP');
    expect(classifySourceKind('yes (web)', 'web - dealer copy')).toBe(
      'WEB_DEALER',
    );
    expect(
      classifySourceKind(
        'yes (web, prime-grade sheet - doubtful)',
        'web - DOUBTFUL: prime-grade sheet for off-grade lot',
      ),
    ).toBe('WEB_DOUBTFUL');
  });

  it('never auto-verifies dealer/doubtful sheets; app can verify when mapped', () => {
    expect(
      initialVerificationStatus({
        sourceKind: 'APP',
        hasFile: true,
        gradeMatched: true,
        ambiguous: false,
      }),
    ).toBe('VERIFIED');
    expect(
      initialVerificationStatus({
        sourceKind: 'WEB_DEALER',
        hasFile: true,
        gradeMatched: true,
        ambiguous: false,
      }),
    ).toBe('PENDING_REVIEW');
    expect(
      initialVerificationStatus({
        sourceKind: 'APP',
        hasFile: true,
        gradeMatched: false,
        ambiguous: false,
      }),
    ).toBe('NEEDS_MAPPING');
    expect(
      initialVerificationStatus({
        sourceKind: 'UNKNOWN',
        hasFile: false,
        gradeMatched: true,
        ambiguous: false,
      }),
    ).toBe('MISSING');
  });

  it('does not invent a SABIC 103 match key from unrelated data', () => {
    const key = buildImportKey({
      category: 'PC_MOULD',
      grade: '103',
      producer: 'SABIC',
      filePath: 'missing:103',
    });
    expect(key).toContain('103');
    expect(key).toContain('SABIC');
  });
});
