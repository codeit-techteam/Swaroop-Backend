import {
  formatCategoryDisplayName,
  humanizeMasterLabel,
  isInternalMasterCode,
} from './category-label';

describe('formatCategoryDisplayName (S-14)', () => {
  it('humanizes snake_case codes like BUTYL_GLYCOL', () => {
    expect(formatCategoryDisplayName('BUTYL_GLYCOL')).toBe('Butyl Glycol');
    expect(formatCategoryDisplayName(null, 'BUTYL_GLYCOL')).toBe('Butyl Glycol');
    expect(humanizeMasterLabel('BASE_OIL')).toBe('Base Oil');
    expect(humanizeMasterLabel('HR_PIB')).toBe('HR PIB');
  });

  it('leaves clean names and acronyms unchanged', () => {
    expect(formatCategoryDisplayName('Base Oil')).toBe('Base Oil');
    expect(formatCategoryDisplayName('ABS')).toBe('ABS');
    expect(formatCategoryDisplayName('ACETONE')).toBe('ACETONE');
  });

  it('detects internal master codes', () => {
    expect(isInternalMasterCode('BUTYL_GLYCOL')).toBe(true);
    expect(isInternalMasterCode('ABS')).toBe(false);
  });
});
