/** Hours an archive stays public after `endedAt`. `-1` means forever. */
export const ARCHIVE_RETENTION_FOREVER = -1;
export const DEFAULT_ARCHIVE_RETENTION_HOURS = 24;

export const ARCHIVE_RETENTION_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '48 hours', hours: 48 },
  { label: '72 hours', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Forever', hours: ARCHIVE_RETENTION_FOREVER },
] as const;

export function normalizeArchiveRetentionHours(
  hours: number | null | undefined,
): number {
  if (hours == null || Number.isNaN(hours)) return DEFAULT_ARCHIVE_RETENTION_HOURS;
  if (hours < 0) return ARCHIVE_RETENTION_FOREVER;
  return Math.floor(hours);
}

export function computeArchiveExpiresAt(
  endedAt: Date | null | undefined,
  retentionHours: number | null | undefined,
): Date | null {
  if (!endedAt) return null;
  const hours = normalizeArchiveRetentionHours(retentionHours);
  if (hours === ARCHIVE_RETENTION_FOREVER) return null;
  const d = new Date(endedAt.getTime());
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

/** Prisma `where` fragment: archive still within its configured retention window. */
export function archiveNotExpiredWhere(now: Date = new Date()) {
  return {
    OR: [
      { archiveRetentionHours: ARCHIVE_RETENTION_FOREVER },
      { archiveExpiresAt: { gt: now } },
      // Legacy rows without expiry yet — treat as still valid until backfilled/cleanup
      {
        AND: [{ archiveExpiresAt: null }, { archiveRetentionHours: { gt: 0 } }],
      },
    ],
  };
}

export function isArchiveExpired(params: {
  archiveRetentionHours?: number | null;
  archiveExpiresAt?: Date | null;
  endedAt?: Date | null;
  now?: Date;
}): boolean {
  const now = params.now ?? new Date();
  const hours = normalizeArchiveRetentionHours(params.archiveRetentionHours);
  if (hours === ARCHIVE_RETENTION_FOREVER) return false;
  if (params.archiveExpiresAt) return params.archiveExpiresAt.getTime() <= now.getTime();
  if (params.endedAt) {
    const exp = computeArchiveExpiresAt(params.endedAt, hours);
    return !!exp && exp.getTime() <= now.getTime();
  }
  return true;
}
