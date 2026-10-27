/**
 * Grade Master category labels (S-14).
 * Converts raw codes like BUTYL_GLYCOL into "Butyl Glycol".
 */

const KEEP_UPPER = new Set([
  'ABS',
  'BOPP',
  'EPDM',
  'EVA',
  'HDPE',
  'HR',
  'KSA',
  'LDPE',
  'LLDPE',
  'MAH',
  'MDI',
  'MFI',
  'MIBK',
  'NBR',
  'NPA',
  'PC',
  'PE',
  'PET',
  'PIB',
  'POE',
  'PP',
  'PS',
  'PVC',
  'R',
  'SBR',
  'TIO2',
  'TPU',
  'TPV',
  'UAE',
  'USA',
  'VAM',
]);

export function isInternalMasterCode(value?: string | null): boolean {
  if (!value) return false;
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value.trim());
}

export function humanizeMasterLabel(value: string): string {
  return value
    .trim()
    .split(/_+/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (KEEP_UPPER.has(upper) || /\d/.test(part)) {
        return upper;
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function formatCategoryDisplayName(
  displayName?: string | null,
  name?: string | null,
  code?: string | null,
): string {
  const raw = (displayName || name || code || '').trim();
  if (!raw) return '';
  if (!raw.includes('_')) return raw;
  return humanizeMasterLabel(raw);
}
