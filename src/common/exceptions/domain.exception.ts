/**
 * Domain exception placeholders for later phases.
 * Business REST error types will extend these patterns from Phase 3 onward.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
