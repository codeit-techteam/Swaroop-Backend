import { randomUUID } from 'node:crypto';

export function formatCreditRef(prefix: string, now = new Date()): string {
  const year = now.getFullYear();
  const seq = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${prefix}-${year}-${seq}`;
}

export async function generateUniqueCreditRef(
  exists: (candidate: string) => Promise<boolean>,
  prefix: string,
  maxAttempts = 12,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = formatCreditRef(prefix);
    if (!(await exists(candidate))) return candidate;
  }
  return `${prefix}-${new Date().getFullYear()}-${randomUUID().slice(0, 8)}`;
}
