/**
 * Vybekart — make lighter (HLS) copies of live archives on this PC.
 *
 * For every archive whose original video is ready but has no adaptive copy yet it:
 *   1. downloads the original MP4 (the original in storage is never changed),
 *   2. runs FFmpeg to make 720p / 480p / 240p versions in streaming-friendly chunks,
 *   3. uploads them through the Vybekart backend (signed uploads, no Supabase keys here),
 *   4. marks the archive ready, so the app plays the version that suits each viewer's network.
 *
 * Setup and usage: see scripts/hls/README.md
 *   npm run hls:process                 process everything pending
 *   npm run hls:process -- --limit 5    only the 5 oldest
 *   npm run hls:process -- --only <id>  one archive
 *   npm run hls:process -- --dry-run    list what would be processed
 */
import { spawn } from 'child_process';
import { createWriteStream, existsSync, readFileSync, statSync } from 'fs';
import { mkdir, open, readdir, rm, writeFile } from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

type Pending = {
  streamId: string;
  title: string | null;
  sellerName: string | null;
  replayUrl: string;
  durationSec: number | null;
  hlsStatus: string;
  hlsUpdatedAt: string | null;
};

type Rendition = {
  name: string;
  shortSide: number;
  videoKbps: number;
  audioKbps: number;
  /** Re-use the original's video frames when it is already H.264 at or below this size. */
  copyIfPossible?: boolean;
};

const RENDITIONS: Rendition[] = [
  { name: 'v720', shortSide: 720, videoKbps: 2800, audioKbps: 128, copyIfPossible: true },
  { name: 'v480', shortSide: 480, videoKbps: 1200, audioKbps: 96 },
  { name: 'v240', shortSide: 240, videoKbps: 350, audioKbps: 64 },
];
/** First variant in the master = what most players start with: the light one starts fastest. */
const MASTER_ORDER = ['v480', 'v720', 'v240'];
const SEGMENT_SECONDS = 4;
const TUS_VERSION = '1.0.0';
/** Skip archives a seller's phone is still working on (it uploads its own copy). */
const DEVICE_GRACE_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------- config

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env.hls'));

const API = (process.env.VYBEKART_API_URL || 'https://vybekart-backend.onrender.com').replace(/\/+$/, '');
const ADMIN_PHONE = normalizePhone(process.env.VYBEKART_ADMIN_PHONE || '');
const ADMIN_EMAIL = process.env.VYBEKART_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.VYBEKART_ADMIN_PASSWORD || '';

/** `9876543210`, `09876543210`, `919876543210` or `+919876543210` → `+919876543210`. */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const WORK_DIR = process.env.HLS_WORK_DIR || path.join(__dirname, 'work');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = Number(option('--limit') || 200);
const ONLY = option('--only');
const DRY_RUN = flag('--dry-run');
const KEEP_FILES = flag('--keep-files');
const FORCE = flag('--force');

// ---------------------------------------------------------------- api

let token = '';

async function login() {
  if ((!ADMIN_PHONE && !ADMIN_EMAIL) || !ADMIN_PASSWORD) {
    throw new Error(
      'Set VYBEKART_ADMIN_PHONE (or VYBEKART_ADMIN_EMAIL) and VYBEKART_ADMIN_PASSWORD in scripts/hls/.env.hls',
    );
  }
  const credentials = ADMIN_PHONE
    ? { phone: ADMIN_PHONE, password: ADMIN_PASSWORD }
    : { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; message?: unknown };
  if (!res.ok || !body.access_token) throw new Error(`Admin login failed (${res.status}): ${JSON.stringify(body.message)}`);
  token = body.access_token;
}

async function api<T>(method: string, route: string, body?: unknown, retried = false): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) {
    await login();
    return api<T>(method, route, body, true);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${JSON.stringify(json.message ?? json)}`);
  return json as T;
}

// ---------------------------------------------------------------- ffmpeg

function run(cmd: string, cmdArgs: string[], quiet = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      err += d;
      if (!quiet) process.stdout.write('.');
    });
    child.on('error', (e) => reject(new Error(`${cmd} could not start: ${e.message}. Is FFmpeg installed?`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-1500)}`));
    });
  });
}

async function probe(file: string) {
  const out = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height:stream_side_data=rotation:format=duration',
    '-of', 'json',
    file,
  ]);
  const json = JSON.parse(out) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[];
    format?: { duration?: string };
  };
  const video = json.streams.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('No video track found');
  const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0);
  const [w, h] = rotation === 90 || rotation === 270 ? [video.height, video.width] : [video.width, video.height];
  return {
    width: w,
    height: h,
    codec: video.codec_name,
    hasAudio: json.streams.some((s) => s.codec_type === 'audio'),
    durationSec: Number(json.format?.duration) || 0,
  };
}

function even(n: number) {
  return Math.max(2, Math.round(n / 2) * 2);
}

async function makeRendition(source: string, outDir: string, r: Rendition, info: Awaited<ReturnType<typeof probe>>) {
  const shortSide = Math.min(info.width, info.height);
  const target = Math.min(r.shortSide, shortSide);
  const portrait = info.height >= info.width;
  const outW = portrait ? even(target) : even((info.width * target) / info.height);
  const outH = portrait ? even((info.height * target) / info.width) : even(target);
  const copy = !!r.copyIfPossible && info.codec === 'h264' && shortSide <= r.shortSide;

  const video = copy
    ? ['-c:v', 'copy']
    : [
        '-vf', `scale=${outW}:${outH}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main',
        '-b:v', `${r.videoKbps}k`, '-maxrate', `${Math.round(r.videoKbps * 1.1)}k`, '-bufsize', `${r.videoKbps * 2}k`,
        '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
      ];
  const audio = info.hasAudio ? ['-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2'] : [];
  await run(
    FFMPEG,
    [
      '-y', '-hide_banner', '-i', source,
      '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []),
      ...video, ...audio,
      '-f', 'hls',
      '-hls_time', String(SEGMENT_SECONDS),
      '-hls_playlist_type', 'vod',
      '-hls_segment_type', 'fmp4',
      '-hls_flags', 'single_file+independent_segments',
      '-hls_fmp4_init_filename', `${r.name}_init.mp4`,
      '-hls_segment_filename', path.join(outDir, `${r.name}.mp4`),
      path.join(outDir, `${r.name}.m3u8`),
    ],
    false,
  );
  return { name: r.name, width: copy ? info.width : outW, height: copy ? info.height : outH };
}

async function folderBytes(dir: string, prefix: string) {
  const names = (await readdir(dir)).filter((n) => n.startsWith(prefix) && !n.endsWith('.m3u8'));
  return names.reduce((sum, n) => sum + statSync(path.join(dir, n)).size, 0);
}

// ---------------------------------------------------------------- upload (TUS, same as the app)

type UploadSlot = { name: string; objectName: string; signature: string; contentType: string };
type UploadSession = { endpoint: string; bucket: string; chunkSizeBytes: number; files: UploadSlot[] };

async function tusUpload(session: UploadSession, slot: UploadSlot, file: string) {
  const total = statSync(file).size;
  const b64 = (v: string) => Buffer.from(v).toString('base64');
  const create = await fetch(session.endpoint, {
    method: 'POST',
    headers: {
      'Tus-Resumable': TUS_VERSION,
      'x-signature': slot.signature,
      'x-upsert': 'true',
      'Upload-Length': String(total),
      'Upload-Metadata': [
        `bucketName ${b64(session.bucket)}`,
        `objectName ${b64(slot.objectName)}`,
        `contentType ${b64(slot.contentType)}`,
        `cacheControl ${b64('31536000')}`,
      ].join(','),
    },
  });
  if (!create.ok) throw new Error(`Upload of ${slot.name} could not start (${create.status}): ${await create.text()}`);
  const location = create.headers.get('location');
  if (!location) throw new Error('Upload server sent no location');
  const uploadUrl = new URL(location, session.endpoint).toString();

  const chunk = Math.min(Math.max(session.chunkSizeBytes, 256 * 1024), 6 * 1024 * 1024);
  const fh = await open(file, 'r');
  try {
    let offset = 0;
    const buf = Buffer.alloc(chunk);
    while (offset < total) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(chunk, total - offset), offset);
      let attempt = 0;
      for (;;) {
        const res = await fetch(uploadUrl, {
          method: 'PATCH',
          headers: {
            'Tus-Resumable': TUS_VERSION,
            'x-signature': slot.signature,
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          body: buf.subarray(0, bytesRead),
        }).catch((e) => e as Error);
        if (!(res instanceof Error) && res.ok) {
          offset = Number(res.headers.get('upload-offset')) || offset + bytesRead;
          break;
        }
        if (++attempt >= 5) {
          throw new Error(`Upload of ${slot.name} failed at ${offset} bytes: ${res instanceof Error ? res.message : res.status}`);
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      process.stdout.write(`\r   uploading ${slot.name}: ${Math.floor((offset / total) * 100)}%   `);
    }
    process.stdout.write('\n');
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- main

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
}

async function processOne(item: Pending) {
  const dir = path.join(WORK_DIR, item.streamId);
  const out = path.join(dir, 'hls');
  await rm(dir, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const source = path.join(dir, 'original.mp4');
  try {
    await api('POST', `/admin/archives/${item.streamId}/hls/status`, { status: 'PROCESSING' });
    console.log('   downloading original…');
    await download(item.replayUrl, source);
    const info = await probe(source);
    console.log(`   original: ${info.width}x${info.height} ${info.codec}, ${Math.round(info.durationSec / 60)} min`);

    const made: { name: string; width: number; height: number; bandwidth: number }[] = [];
    for (const r of RENDITIONS) {
      process.stdout.write(`   making ${r.name} `);
      const res = await makeRendition(source, out, r, info);
      const bytes = await folderBytes(out, r.name);
      const bandwidth = Math.round(((bytes * 8) / Math.max(info.durationSec, 1)) * 1.15);
      made.push({ ...res, bandwidth });
      process.stdout.write(' done\n');
    }

    const ordered = MASTER_ORDER.map((n) => made.find((m) => m.name === n)).filter(Boolean) as typeof made;
    const master = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      ...ordered.flatMap((m) => [
        `#EXT-X-STREAM-INF:BANDWIDTH=${m.bandwidth},AVERAGE-BANDWIDTH=${Math.round(m.bandwidth / 1.15)},RESOLUTION=${m.width}x${m.height}`,
        `${m.name}.m3u8`,
      ]),
      '',
    ].join('\n');
    await writeFile(path.join(out, 'master.m3u8'), master);

    const names = (await readdir(out)).filter((n) => /^[a-z0-9][a-z0-9_-]{0,40}\.(m3u8|mp4|m4s)$/.test(n));
    const files = names.map((name) => ({ name, sizeBytes: statSync(path.join(out, name)).size }));
    const session = await api<UploadSession>('POST', `/admin/archives/${item.streamId}/hls/upload-session`, { files });
    for (const slot of session.files) {
      await tusUpload(session, slot, path.join(out, slot.name));
    }
    await api('POST', `/admin/archives/${item.streamId}/hls/complete`, { files, master: 'master.m3u8' });
    console.log('   ✔ ready — the app now picks the quality that suits each viewer');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`   ✖ ${message}`);
    await api('POST', `/admin/archives/${item.streamId}/hls/status`, {
      status: 'FAILED',
      error: message.slice(0, 450),
    }).catch(() => undefined);
  } finally {
    if (!KEEP_FILES) await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  await run(FFMPEG, ['-version']);
  await login();
  const { items } = await api<{ items: Pending[] }>('GET', `/admin/archives/hls/pending?limit=${Math.min(LIMIT, 200)}`);
  const now = Date.now();
  const todo = items
    .filter((i) => !ONLY || i.streamId === ONLY)
    .filter(
      (i) =>
        FORCE ||
        i.hlsStatus !== 'PROCESSING' ||
        !i.hlsUpdatedAt ||
        now - new Date(i.hlsUpdatedAt).getTime() > DEVICE_GRACE_MS,
    )
    .slice(0, LIMIT);

  console.log(`${todo.length} archive(s) to process (of ${items.length} pending)`);
  for (const [i, item] of todo.entries()) {
    console.log(`\n[${i + 1}/${todo.length}] ${item.title ?? 'Live'} — ${item.sellerName ?? ''} (${item.streamId})`);
    if (DRY_RUN) continue;
    await processOne(item);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
