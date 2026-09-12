import { BadRequestException } from '@nestjs/common';

export type AnalyticsPeriod = {
  from: Date;
  to: Date;
  /** ISO date strings for API meta */
  fromIso: string;
  toIso: string;
  defaultApplied: boolean;
};

/**
 * Resolve analytics date range.
 * Default: start of current UTC month → now (UTC).
 * Documented for clients; never invents arbitrary fixed calendar dates.
 */
export function resolveAnalyticsPeriod(
  from?: string,
  to?: string,
): AnalyticsPeriod {
  const now = new Date();
  let defaultApplied = false;
  let fromDate: Date;
  let toDate: Date;

  if (!from && !to) {
    defaultApplied = true;
    fromDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    toDate = now;
  } else if (from && !to) {
    fromDate = new Date(from);
    toDate = now;
  } else if (!from && to) {
    toDate = new Date(to);
    fromDate = new Date(
      Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1, 0, 0, 0, 0),
    );
    defaultApplied = true;
  } else {
    fromDate = new Date(from!);
    toDate = new Date(to!);
  }

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid date range',
    });
  }

  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'from must be less than or equal to to',
    });
  }

  return {
    from: fromDate,
    to: toDate,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
    defaultApplied,
  };
}

export type TrendGranularity = 'day' | 'week' | 'month';

export function resolveTrendGranularity(
  from: Date,
  to: Date,
  explicit?: TrendGranularity,
): TrendGranularity {
  if (explicit) return explicit;
  const days = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 45) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

export function dateTruncUnit(g: TrendGranularity): 'day' | 'week' | 'month' {
  return g;
}
