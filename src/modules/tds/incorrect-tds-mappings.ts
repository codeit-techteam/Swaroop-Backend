/**
 * Confirmed wrong grade-to-file links. These documents stay in the library
 * for Admin review, but must not be shown as the TDS for the named grade.
 * Do not attach a replacement until the client maps a verified file.
 */
const INCORRECT_TDS_FILES = [
  {
    fileName: 'abs_extrusion_sr101_tds.pdf',
    gradeMustMatch: /3000D/i,
    gradeMustNotBe: /\bSR101\b/i,
  },
] as const;

export function isKnownIncorrectTdsMapping(input: {
  originalFilename?: string | null;
  gradeName?: string | null;
  gradeNo?: string | null;
  fullGradeName?: string | null;
  displayName?: string | null;
  gradeCode?: string | null;
}): boolean {
  const file = (input.originalFilename ?? '').trim().toLowerCase();
  const hay = [
    input.gradeName,
    input.gradeNo,
    input.fullGradeName,
    input.displayName,
    input.gradeCode,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');
  return INCORRECT_TDS_FILES.some((rule) => {
    if (file !== rule.fileName) return false;
    if (!rule.gradeMustMatch.test(hay)) return false;
    if (rule.gradeMustNotBe.test(hay) && !rule.gradeMustMatch.test(hay)) {
      return false;
    }
    // SR101's own sheet mentions SR101 and must stay attached to that grade.
    if (/\bSR101\b/i.test(hay) && !/3000D/i.test(hay)) return false;
    return true;
  });
}
