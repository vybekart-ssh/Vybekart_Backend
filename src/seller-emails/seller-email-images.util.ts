import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { ResendInlineAttachment } from './seller-email.types';

export const VYBEKART_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.vybekart.app';

export const SELLER_EMAIL_ASSET_FILES = {
  visibilityIntro: 'seller-visibility-intro.png',
  goLiveSteps: 'seller-go-live-steps.png',
} as const;

const DEFAULT_SUPABASE_HOST =
  'https://axcsnealmdadjryogrnl.supabase.co/storage/v1/object/public/Vybekart/email';

export interface ResolvedEmailImage {
  src: string;
  attachment?: ResendInlineAttachment;
}

function assetsDir(): string {
  return path.join(process.cwd(), 'scripts', 'email', 'assets');
}

function localAssetPath(fileName: string): string {
  return path.join(assetsDir(), fileName);
}

function supabasePublicObjectUrl(
  config: ConfigService,
  objectKey: string,
): string {
  const supabase = config.get<string>('SUPABASE_URL')?.trim().replace(/\/$/, '');
  const bucket = config.get<string>('SUPABASE_PUBLIC_BUCKET')?.trim() || 'Vybekart';
  if (supabase) {
    return `${supabase}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectKey.replace(/^\/+/, '')}`;
  }
  return `${DEFAULT_SUPABASE_HOST}/${objectKey.replace(/^\/+/, '')}`;
}

function localAssetDataUri(fileName: string): string | null {
  const filePath = localAssetPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function loadInlineAttachment(
  fileName: string,
  contentId: string,
): ResendInlineAttachment | null {
  const filePath = localAssetPath(fileName);
  if (!fs.existsSync(filePath)) return null;
  return {
    filename: fileName,
    content: fs.readFileSync(filePath).toString('base64'),
    content_id: contentId,
    content_type: 'image/png',
  };
}

export function resolveSellerEmailImage(
  config: ConfigService,
  opts: {
    envUrlKey: string;
    assetFileName: string;
    objectKey: string;
    contentId: string;
    forPreview: boolean;
  },
): ResolvedEmailImage {
  if (opts.forPreview) {
    const dataUri = localAssetDataUri(opts.assetFileName);
    if (dataUri) return { src: dataUri };
    const explicit = config.get<string>(opts.envUrlKey)?.trim();
    if (explicit) return { src: explicit };
    return { src: supabasePublicObjectUrl(config, opts.objectKey) };
  }

  const attachment = loadInlineAttachment(opts.assetFileName, opts.contentId);
  if (attachment) {
    return { src: `cid:${opts.contentId}`, attachment };
  }

  const explicit = config.get<string>(opts.envUrlKey)?.trim();
  if (explicit) return { src: explicit };

  return { src: supabasePublicObjectUrl(config, opts.objectKey) };
}

export function collectAttachments(
  images: ResolvedEmailImage[],
): ResendInlineAttachment[] {
  const out: ResendInlineAttachment[] = [];
  for (const img of images) {
    if (img.attachment) out.push(img.attachment);
  }
  return out;
}
