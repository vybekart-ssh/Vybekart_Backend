/** Normalize LIVEKIT_URL for server SDK (RoomServiceClient / EgressClient use HTTPS API). */
export function normalizeLiveKitApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`;
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`;
  return trimmed;
}

export function isLiveKitUnreachableError(err: unknown): boolean {
  const parts: string[] = [];
  const visit = (e: unknown, depth = 0) => {
    if (depth > 4 || e == null) return;
    if (e instanceof Error) {
      parts.push(e.message);
      const coded = e as Error & { code?: string };
      if (coded.code) parts.push(coded.code);
      if (e.cause) visit(e.cause, depth + 1);
    } else {
      parts.push(String(e));
    }
  };
  visit(err);
  const blob = parts.join(' | ').toLowerCase();
  return [
    'econnrefused',
    'enotfound',
    'etimedout',
    'fetch failed',
    'connect timeout',
    'und_err_connect_timeout',
    'socket hang up',
    'econnreset',
    'network',
  ].some((needle) => blob.includes(needle));
}

export function liveKitUnreachableMessage(err: unknown): string {
  const base =
    'LiveKit server is unreachable from the API. Verify LIVEKIT_URL (use https://your-project.livekit.cloud for LiveKit Cloud), API key/secret, and that the project is active.';
  if (err instanceof Error && err.message && !err.message.includes('fetch failed')) {
    return `${base} (${err.message})`;
  }
  return base;
}
