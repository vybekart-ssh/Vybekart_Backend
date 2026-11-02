import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HlsUploadSessionDto } from './dto/stream-hls.dto';
import { hlsContentType, StreamHlsService } from './stream-hls.service';

const STREAM_ID = 's-1';
const files = [
  { name: 'master.m3u8', sizeBytes: 300 },
  { name: 'v480.m3u8', sizeBytes: 900 },
  { name: 'v480.mp4', sizeBytes: 50_000_000 },
];

function setup(stream: Record<string, unknown> = {}, sizes: Record<string, number | null> = {}) {
  const row = {
    id: STREAM_ID,
    endedAt: new Date(),
    replayUrl: 'https://cdn/x.mp4',
    replayStatus: 'READY',
    hlsStatus: 'NONE',
    hlsUrl: null,
    seller: { userId: 'seller-user' },
    ...stream,
  };
  const prisma = {
    stream: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const storage = {
    publicBucket: () => 'public',
    signedResumableUploadEndpoint: () => 'https://p.storage.supabase.co/storage/v1/upload/resumable/sign',
    createSignedUploadToken: jest.fn().mockResolvedValue('sig'),
    headObjectSize: jest.fn().mockImplementation((_b: string, key: string) => {
      const name = key.split('/').pop()!;
      if (name in sizes) return Promise.resolve(sizes[name]);
      return Promise.resolve(files.find((f) => f.name === name)?.sizeBytes ?? null);
    }),
    buildPublicUrl: (b: string, k: string) => `https://cdn/${b}/${k}`,
  };
  const config = { get: () => undefined };
  const service = new StreamHlsService(prisma as never, config as never, storage as never);
  return { service, prisma, storage };
}

describe('StreamHlsService', () => {
  it('signs one upload slot per file under vybekart-replays/hls/<id>/', async () => {
    const { service, prisma } = setup();
    const res = await service.createUploadSession(STREAM_ID, { files }, 'seller-user');
    expect(res.files.map((f) => f.objectName)).toEqual([
      'vybekart-replays/hls/s-1/master.m3u8',
      'vybekart-replays/hls/s-1/v480.m3u8',
      'vybekart-replays/hls/s-1/v480.mp4',
    ]);
    expect(res.files[0].contentType).toBe('application/vnd.apple.mpegurl');
    expect(prisma.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hlsStatus: 'PROCESSING' }) }),
    );
  });

  it("rejects another seller's live", async () => {
    const { service } = setup();
    await expect(service.createUploadSession(STREAM_ID, { files }, 'someone-else')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('marks READY with the master URL only when every file is fully uploaded', async () => {
    const { service, prisma } = setup();
    const res = await service.complete(STREAM_ID, { files, master: 'master.m3u8' }, 'DEVICE', 'seller-user');
    expect(res.hlsUrl).toBe('https://cdn/public/vybekart-replays/hls/s-1/master.m3u8');
    expect(prisma.stream.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hlsStatus: 'READY', hlsSource: 'DEVICE' }),
      }),
    );
  });

  it('refuses to complete with a missing or partial file', async () => {
    const missing = setup({}, { 'v480.mp4': null });
    await expect(missing.service.complete(STREAM_ID, { files, master: 'master.m3u8' }, 'ADMIN_TOOL')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const partial = setup({}, { 'v480.mp4': 10 });
    await expect(partial.service.complete(STREAM_ID, { files, master: 'master.m3u8' }, 'ADMIN_TOOL')).rejects.toThrow(
      /incomplete/,
    );
  });

  it('never downgrades a ready copy on a late failure report', async () => {
    const { service, prisma } = setup({ hlsStatus: 'READY', hlsUrl: 'https://cdn/m.m3u8' });
    const res = await service.reportStatus(STREAM_ID, { status: 'FAILED', error: 'x' });
    expect(res.hlsStatus).toBe('READY');
    expect(prisma.stream.update).not.toHaveBeenCalled();
  });

  it('only accepts flat playlist / media file names', async () => {
    const bad = plainToInstance(HlsUploadSessionDto, {
      files: [
        { name: '../evil.m3u8', sizeBytes: 1 },
        { name: 'v480.exe', sizeBytes: 1 },
      ],
    });
    const errors = await validate(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(hlsContentType('v240.m4s')).toBe('video/iso.segment');
  });
});
