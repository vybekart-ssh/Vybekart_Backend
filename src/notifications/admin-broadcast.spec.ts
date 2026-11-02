import { BadRequestException } from '@nestjs/common';
import { StreamReplayStatus } from '@prisma/client';
import { AdminBroadcastService, archiveShareUrl } from './admin-broadcast.service';

const ARCHIVE_ID = '3f1c2b4a-8d9e-4f10-9a2b-1c3d4e5f6a7b';

function readyArchive(overrides: Record<string, unknown> = {}) {
  return {
    id: ARCHIVE_ID,
    title: 'Diwali saree drop',
    isLive: false,
    endedAt: new Date(Date.now() - 60 * 60 * 1000),
    replayUrl: 'https://cdn.example.com/replay.mp4',
    replayStatus: StreamReplayStatus.READY,
    archiveRetentionHours: 24 * 30,
    archiveExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    thumbnailUrl: null,
    seller: { businessName: 'Asha Textiles', logoUrl: null },
    streamProducts: [{ product: { images: ['https://cdn.example.com/saree.jpg'] } }],
    ...overrides,
  };
}

function setup(archive: unknown = readyArchive()) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    userPushDevice: { findMany: jest.fn().mockResolvedValue([{ fcmToken: 'tok-1' }]) },
    buyer: { findMany: jest.fn().mockResolvedValue([]) },
    stream: { findUnique: jest.fn().mockResolvedValue(archive) },
    adminBroadcast: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'b-1', ...data })),
    },
    notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const firebase = { sendToTokensBatched: jest.fn().mockResolvedValue({ success: 1, failure: 0 }) };
  const redis = { setNx: jest.fn().mockResolvedValue(true) };
  const service = new AdminBroadcastService(prisma as never, firebase as never, redis as never);
  return { service, prisma, firebase };
}

describe('AdminBroadcastService', () => {
  it('pages through the full recipient list', async () => {
    const { service, prisma } = setup();
    prisma.user.count.mockResolvedValue(75);
    const res = await service.searchRecipients({ role: 'SELLER', page: 2, limit: 30 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 30, take: 30 }));
    expect(res).toMatchObject({ total: 75, page: 2, limit: 30, hasMore: true });

    const last = await service.searchRecipients({ role: 'SELLER', page: 3, limit: 30 });
    expect(last.hasMore).toBe(false);
  });

  it('attaches a playable archive: deep link data, default message and thumbnail', async () => {
    const { service, firebase, prisma } = setup();
    await service.send({ audience: 'ALL_USERS', archiveStreamId: ARCHIVE_ID, sentByUserId: 'admin' });

    const [, , body, data, opts] = firebase.sendToTokensBatched.mock.calls[0];
    expect(data).toMatchObject({
      type: 'ADMIN_BROADCAST',
      archiveStreamId: ARCHIVE_ID,
      archiveUrl: archiveShareUrl(ARCHIVE_ID),
      imageUrl: 'https://cdn.example.com/saree.jpg',
    });
    expect(body).toContain('Diwali saree drop');
    expect(body).toContain('Asha Textiles');
    expect(opts.android.imageUrl).toBe('https://cdn.example.com/saree.jpg');
    expect(prisma.adminBroadcast.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ archiveStreamId: ARCHIVE_ID, archiveTitle: 'Diwali saree drop' }),
    });
  });

  it('keeps the admin message and image when an archive is attached', async () => {
    const { service, firebase } = setup();
    await service.send({
      audience: 'ALL_BUYERS',
      body: 'New collection live replay',
      imageUrl: 'https://cdn.example.com/banner.jpg',
      archiveStreamId: ARCHIVE_ID,
      sentByUserId: 'admin',
    });
    const [, , body, data] = firebase.sendToTokensBatched.mock.calls[0];
    expect(body).toBe('New collection live replay');
    expect(data.imageUrl).toBe('https://cdn.example.com/banner.jpg');
  });

  it.each([
    ['missing', null, 'no longer exists'],
    ['still live', readyArchive({ isLive: true }), 'not ended'],
    ['not processed', readyArchive({ replayStatus: StreamReplayStatus.RECORDING }), 'not ready'],
    ['missing its video', readyArchive({ replayUrl: '  ' }), 'not ready'],
  ])('rejects an archive that is %s without sending', async (_, archive, message) => {
    const { service, firebase } = setup(archive);
    await expect(
      service.send({ audience: 'ALL_USERS', archiveStreamId: ARCHIVE_ID, sentByUserId: 'admin' }),
    ).rejects.toThrow(new RegExp(message));
    expect(firebase.sendToTokensBatched).not.toHaveBeenCalled();
  });

  it('still requires some content when no archive is attached', async () => {
    const { service } = setup();
    await expect(service.send({ audience: 'ALL_USERS', sentByUserId: 'admin' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
