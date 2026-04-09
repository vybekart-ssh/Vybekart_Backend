import { ConfigService } from '@nestjs/config';

function pickBase(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t.length > 0) return t.replace(/\/$/, '');
    }
  }
  return 'http://localhost:3000';
}

/**
 * Public base URL for links returned to clients (uploads, packing video, etc.).
 * Prefer API_PUBLIC_URL; on Render use RENDER_EXTERNAL_URL when unset.
 */
export function resolvePublicBaseUrl(config: ConfigService): string {
  return pickBase(
    config.get<string>('API_PUBLIC_URL'),
    config.get<string>('RENDER_EXTERNAL_URL'),
    process.env.API_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
  );
}
