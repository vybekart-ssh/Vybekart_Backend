/** Hours an archive stays public after `endedAt`. `-1` means forever. */
export const ARCHIVE_RETENTION_FOREVER = -1;
export const DEFAULT_ARCHIVE_RETENTION_HOURS = ARCHIVE_RETENTION_FOREVER;

/** Archives are never removed automatically — forever is the only retention. */
export const ARCHIVE_RETENTION_OPTIONS = [
  { label: 'Forever', hours: ARCHIVE_RETENTION_FOREVER },
] as const;

export function normalizeArchiveRetentionHours(
  _hours?: number | null,
): number {
  return ARCHIVE_RETENTION_FOREVER;
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

/** Prisma `where` fragment for live archives. Archives never expire, so nothing is filtered out. */
export function archiveNotExpiredWhere(_now?: Date): Record<string, never> {
  return {};
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
