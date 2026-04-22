import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type SupabaseObjectRow = {
  name: string;
  id?: string;
  created_at?: string;
  updated_at?: string;
  last_accessed_at?: string;
  metadata?: {
    size?: number;
    mimetype?: string;
  };
};

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);

  constructor(private readonly config: ConfigService) {}

  private supabaseUrl(): string | null {
    const u = this.config.get<string>('SUPABASE_URL')?.trim().replace(/\/$/, '');
    return u || null;
  }

  private serviceRoleKey(): string | null {
    const k = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    return k || null;
  }

  publicBucket(): string {
    return (
      this.config.get<string>('SUPABASE_PUBLIC_BUCKET')?.trim() ||
      'Vybekart'
    );
  }

  buildPublicUrl(bucket: string, objectKey: string): string | null {
    const base = this.supabaseUrl();
    const key = objectKey.replace(/^\/+/, '');
    if (!base || !bucket || !key) return null;
    return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`;
  }

  private headers(): HeadersInit {
    const key = this.serviceRoleKey();
    if (!key) {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is required for Storage API operations',
      );
    }
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
  }

  async uploadPublicObject(params: {
    bucket: string;
    objectKey: string;
    contentType: string;
    bytes: Buffer;
    cacheControlSeconds?: number;
    upsert?: boolean;
  }): Promise<{ publicUrl: string; key: string }> {
    const base = this.supabaseUrl();
    if (!base) throw new Error('SUPABASE_URL is required for Storage uploads');
    const { bucket } = params;
    const key = params.objectKey.replace(/^\/+/, '');
    const url = `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': params.contentType,
        ...(params.cacheControlSeconds != null
          ? { 'cache-control': String(params.cacheControlSeconds) }
          : {}),
        ...(params.upsert ? { 'x-upsert': 'true' } : {}),
      },
      // Node's fetch types can be picky; Buffer is valid at runtime.
      body: params.bytes as unknown as BodyInit,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase upload failed (${res.status}): ${body}`);
    }
    const publicUrl =
      this.buildPublicUrl(bucket, key) ||
      `${base}/storage/v1/object/public/${bucket}/${key}`;
    return { publicUrl, key };
  }

  async listObjects(params: {
    bucket: string;
    prefix: string;
    limit?: number;
    offset?: number;
    sortBy?: { column: 'name' | 'created_at' | 'updated_at'; order: 'asc' | 'desc' };
  }): Promise<SupabaseObjectRow[]> {
    const base = this.supabaseUrl();
    if (!base) throw new Error('SUPABASE_URL is required for Storage list');
    const url = `${base}/storage/v1/object/list/${encodeURIComponent(params.bucket)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: params.prefix,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
        sortBy: params.sortBy ?? { column: 'created_at', order: 'asc' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase list failed (${res.status}): ${body}`);
    }
    return (await res.json()) as SupabaseObjectRow[];
  }

  async deleteObjects(params: {
    bucket: string;
    prefixes: string[];
  }): Promise<void> {
    if (params.prefixes.length === 0) return;
    const base = this.supabaseUrl();
    if (!base) throw new Error('SUPABASE_URL is required for Storage delete');
    const url = `${base}/storage/v1/object/${encodeURIComponent(params.bucket)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: params.prefixes }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase delete failed (${res.status}): ${body}`);
    }
  }

  /** Best-effort delete; logs failures instead of throwing. */
  async tryDeleteMany(bucket: string, prefixes: string[]): Promise<void> {
    try {
      await this.deleteObjects({ bucket, prefixes });
    } catch (e) {
      this.logger.warn(
        `Supabase delete failed (bucket=${bucket}, n=${prefixes.length}): ${String(e)}`,
      );
    }
  }
}

