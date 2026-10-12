import { BadRequestException } from '@nestjs/common';

export type InsightsPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';
export type InsightsGranularity = 'hour3' | 'day' | 'week' | 'month';

export const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_CUSTOM_RANGE_DAYS = 366;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const HOUR3_LABELS = [
  '12 AM', '3 AM', '6 AM', '9 AM', '12 PM', '3 PM', '6 PM', '9 PM',
];

export interface InsightsWindow {
  /** Inclusive IST calendar dates (YYYY-MM-DD). */
  from: string;
  to: string;
  gte: Date;
  lt: Date;
  days: number;
  label: string;
}

export interface InsightsRange extends InsightsWindow {
  period: InsightsPeriod;
  granularity: InsightsGranularity;
  previous: InsightsWindow;
}

export interface InsightsBucket {
  label: string;
  startMs: number;
  endMs: number;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** IST calendar date of an instant, as YYYY-MM-DD. */
export function istYmd(date: Date): string {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return toYmdString({
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  });
}

/** Same instant with IST wall-clock fields exposed through the UTC getters (for Excel / labels). */
export function toIstWallClock(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function parseYmd(value: string): Ymd {
  const [y, m, d] = value.split('-').map(Number);
  return { y, m, d };
}

function toYmdString({ y, m, d }: Ymd): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function istDayStart(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

function addDays(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toYmdString({
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
  });
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((istDayStart(to).getTime() - istDayStart(from).getTime()) / DAY_MS) + 1;
}

function isValidYmd(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseYmd(value);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function formatIstDay(ymd: string, withYear = true): string {
  const { y, m, d } = parseYmd(ymd);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

function rangeLabel(from: string, to: string): string {
  if (from === to) return formatIstDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatIstDay(from, !sameYear)} – ${formatIstDay(to)}`;
}

function buildWindow(from: string, to: string, label?: string): InsightsWindow {
  return {
    from,
    to,
    gte: istDayStart(from),
    lt: istDayStart(addDays(to, 1)),
    days: daysBetweenInclusive(from, to),
    label: label ?? rangeLabel(from, to),
  };
}

function granularityFor(days: number): InsightsGranularity {
  if (days <= 1) return 'hour3';
  if (days <= 62) return 'day';
  if (days <= 182) return 'week';
  return 'month';
}

export function normalizePeriod(raw?: string): InsightsPeriod {
  const p = (raw ?? 'daily').trim().toLowerCase();
  if (p === 'daily' || p === 'weekly' || p === 'monthly' || p === 'custom') return p;
  throw new BadRequestException('period must be daily, weekly, monthly or custom');
}

/**
 * Resolves the reporting window in IST.
 * daily = today · weekly = last 7 days incl. today · monthly = this calendar month to date ·
 * custom = inclusive from/to (max 366 days, not in the future).
 * `previous` is the comparison window used for trend percentages.
 */
export function resolveInsightsRange(
  rawPeriod?: string,
  from?: string,
  to?: string,
  now: Date = new Date(),
): InsightsRange {
  const period = normalizePeriod(rawPeriod);
  const today = istYmd(now);

  let current: InsightsWindow;
  let previous: InsightsWindow;

  switch (period) {
    case 'daily': {
      current = buildWindow(today, today, `Today, ${formatIstDay(today)}`);
      const yesterday = addDays(today, -1);
      previous = buildWindow(yesterday, yesterday);
      break;
    }
    case 'weekly': {
      const start = addDays(today, -6);
      current = buildWindow(start, today);
      previous = buildWindow(addDays(start, -7), addDays(start, -1));
      break;
    }
    case 'monthly': {
      const { y, m, d } = parseYmd(today);
      const start = toYmdString({ y, m, d: 1 });
      current = buildWindow(start, today);
      const prevMonthEnd = addDays(start, -1);
      const prev = parseYmd(prevMonthEnd);
      const prevStart = toYmdString({ y: prev.y, m: prev.m, d: 1 });
      const prevTo = toYmdString({ y: prev.y, m: prev.m, d: Math.min(d, prev.d) });
      previous = buildWindow(prevStart, prevTo);
      break;
    }
    case 'custom': {
      if (!isValidYmd(from) || !isValidYmd(to)) {
        throw new BadRequestException('Custom range needs valid from and to dates (YYYY-MM-DD)');
      }
      if (from > to) {
        throw new BadRequestException('Start date must be on or before the end date');
      }
      if (to > today) {
        throw new BadRequestException('End date cannot be in the future');
      }
      const days = daysBetweenInclusive(from, to);
      if (days > MAX_CUSTOM_RANGE_DAYS) {
        throw new BadRequestException(
          `Custom range can be at most ${MAX_CUSTOM_RANGE_DAYS} days`,
        );
      }
      current = buildWindow(from, to);
      previous = buildWindow(addDays(from, -days), addDays(from, -1));
      break;
    }
  }

  return {
    ...current,
    period,
    granularity: granularityFor(current.days),
    previous,
  };
}

export function buildInsightsBuckets(range: InsightsRange): InsightsBucket[] {
  const startMs = range.gte.getTime();
  const endMs = range.lt.getTime();
  const buckets: InsightsBucket[] = [];

  switch (range.granularity) {
    case 'hour3':
      for (let i = 0; i < 8; i++) {
        buckets.push({
          label: HOUR3_LABELS[i],
          startMs: startMs + i * 3 * 60 * 60 * 1000,
          endMs: startMs + (i + 1) * 3 * 60 * 60 * 1000,
        });
      }
      break;
    case 'day':
      for (let i = 0; i < range.days; i++) {
        const ymd = addDays(range.from, i);
        buckets.push({
          label: formatIstDay(ymd, false),
          startMs: startMs + i * DAY_MS,
          endMs: startMs + (i + 1) * DAY_MS,
        });
      }
      break;
    case 'week':
      for (let i = 0; i < range.days; i += 7) {
        buckets.push({
          label: formatIstDay(addDays(range.from, i), false),
          startMs: startMs + i * DAY_MS,
          endMs: Math.min(endMs, startMs + (i + 7) * DAY_MS),
        });
      }
      break;
    case 'month': {
      let cursor = parseYmd(range.from);
      while (true) {
        const monthStart = toYmdString({ y: cursor.y, m: cursor.m, d: 1 });
        const next = cursor.m === 12 ? { y: cursor.y + 1, m: 1, d: 1 } : { y: cursor.y, m: cursor.m + 1, d: 1 };
        const bStart = Math.max(startMs, istDayStart(monthStart).getTime());
        const bEnd = Math.min(endMs, istDayStart(toYmdString(next)).getTime());
        if (bStart >= endMs) break;
        buckets.push({
          label: `${MONTHS[cursor.m - 1]} '${String(cursor.y).slice(2)}`,
          startMs: bStart,
          endMs: bEnd,
        });
        cursor = next;
      }
      break;
    }
  }
  return buckets;
}

export function bucketIndexFor(buckets: InsightsBucket[], ms: number): number {
  for (let i = 0; i < buckets.length; i++) {
    if (ms >= buckets[i].startMs && ms < buckets[i].endMs) return i;
  }
  return -1;
}

/** Percent change vs previous window; null when there was nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous > 0) {
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }
  return current > 0 ? null : 0;
}
