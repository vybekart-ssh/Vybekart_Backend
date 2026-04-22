import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { ScheduleStreamDto } from './dto/schedule-stream.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, StreamReplayStatus, VerificationStatus } from '@prisma/client';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { LiveKitService } from '../livekit/livekit.service';
import { RedisService } from '../redis/redis.service';
import { BuyerLiveBroadcastService } from '../notifications/buyer-live-broadcast.service';

const streamWithSellerInclude = {
  seller: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
  streamProducts: {
    include: { product: true },
    orderBy: { sortOrder: 'asc' },
  },
  category: { select: { id: true, name: true, slug: true } },
} as const;

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);

  constructor(
    private prisma: PrismaService,
    private livekit: LiveKitService,
    private redis: RedisService,
    private buyerLiveBroadcast: BuyerLiveBroadcastService,
  ) {}

  private queueNotifyBuyersLiveStarted(stream: {
    id: string;
    title: string;
    seller: { userId: string; user?: { name?: string | null } | null };
  }) {
    const sellerDisplayName =
      stream.seller?.user?.name?.trim() || 'A seller';
    void this.buyerLiveBroadcast
      .notifyBuyersSellerWentLive({
        streamId: stream.id,
        title: stream.title,
        sellerUserId: stream.seller.userId,
        sellerDisplayName,
      })
      .catch((e) =>
        this.logger.warn(`Buyer live-started notification: ${String(e)}`),
      );
  }

  private queueNotifyBuyersLiveEnded(
    stream: {
      id: string;
      title: string;
      seller: { userId: string; user?: { name?: string | null } | null };
    },
    opts?: { notifyBuyers?: boolean },
  ) {
    if (opts?.notifyBuyers === false) return;
    const sellerDisplayName =
      stream.seller?.user?.name?.trim() || 'A seller';
    void this.buyerLiveBroadcast
      .notifyBuyersLiveEnded({
        streamId: stream.id,
        title: stream.title,
        sellerUserId: stream.seller.userId,
        sellerDisplayName,
      })
      .catch((e) =>
        this.logger.warn(`Buyer live-ended notification: ${String(e)}`),
      );
  }

  private likesKey(streamId: string) {
    return `stream:${streamId}:likes`;
  }
  private commentsKey(streamId: string) {
    return `stream:${streamId}:comments`;
  }
  private bidsKey(streamId: string) {
    return `stream:${streamId}:bids`;
  }
  private followsKey(userId: string) {
    return `buyer:${userId}:follows`;
  }

  private async tryStartStreamRecording(
    streamId: string,
    roomName: string,
  ): Promise<void> {
    if (!this.livekit.isReplayRecordingConfigured()) return;
    try {
      const egressId = await this.livekit.startRoomRecording(roomName);
      if (!egressId) return;
      await this.prisma.stream.update({
        where: { id: streamId },
        data: {
          livekitEgressId: egressId,
          replayStatus: StreamReplayStatus.RECORDING,
        },
      });
    } catch (e) {
      this.logger.warn(`tryStartStreamRecording ${streamId}: ${String(e)}`);
    }
  }

  private async finalizeLiveRecordingAndRoom(stream: {
    id: string;
    livekitRoomName: string | null;
    livekitEgressId: string | null;
  }): Promise<Prisma.StreamUpdateInput> {
    const patch: Prisma.StreamUpdateInput = {};
    if (stream.livekitEgressId && this.livekit.isReplayRecordingConfigured()) {
      try {
        const r = await this.livekit.stopRoomRecording(stream.livekitEgressId);
        patch.livekitEgressId = null;
        const replayUrl =
          r.replayUrl ||
          (!r.failed ? this.livekit.publicReplayUrlForStreamId(stream.id) : null);
        if (replayUrl) {
          patch.replayUrl = replayUrl;
          if (r.durationSec != null) patch.replayDurationSec = r.durationSec;
          patch.replayStatus = StreamReplayStatus.READY;
        } else if (r.failed) {
          patch.replayStatus = StreamReplayStatus.FAILED;
        }
      } catch {
        patch.livekitEgressId = null;
        patch.replayStatus = StreamReplayStatus.FAILED;
      }
    } else if (stream.livekitEgressId) {
      patch.livekitEgressId = null;
    }
    if (stream.livekitRoomName) {
      await this.livekit.deleteRoom(stream.livekitRoomName).catch(() => undefined);
    }
    return patch;
  }

  async create(createStreamDto: CreateStreamDto, userId: string) {
    if (!this.livekit.isConfigured()) {
      throw new BadRequestException(
        'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
      );
    }

    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }

    const productIds = createStreamDto.productIds ?? [];
    if (productIds.length < 1 || productIds.length > 3) {
      throw new BadRequestException(
        'Select between 1 and 3 products to go live.',
      );
    }
    const sellerProducts = await this.prisma.product.findMany({
      where: { sellerId: seller.id, id: { in: productIds } },
      select: { id: true },
    });
    const foundIds = new Set(sellerProducts.map((p) => p.id));
    const invalid = productIds.filter((id) => !foundIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Products not found or not owned by you: ${invalid.join(', ')}`,
      );
    }

    if (createStreamDto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: createStreamDto.categoryId },
      });
      if (!category) {
        throw new BadRequestException(
          `Category not found: ${createStreamDto.categoryId}`,
        );
      }
    }

    const visibility =
      createStreamDto.visibility === 'FOLLOWERS_ONLY'
        ? 'FOLLOWERS_ONLY'
        : 'PUBLIC';

    const now = new Date();
    const stream = await this.prisma.stream.create({
      data: {
        title: createStreamDto.title,
        description: createStreamDto.description,
        categoryId: createStreamDto.categoryId ?? null,
        visibility,
        sellerId: seller.id,
        isLive: true,
        startedAt: now,
        sellerLiveHeartbeatAt: now,
        streamProducts: {
          create: productIds.map((productId, index) => ({
            productId,
            sortOrder: index,
          })),
        },
      },
      include: streamWithSellerInclude,
    });

    const roomName = stream.id;
    try {
      await this.livekit.createRoom(
        roomName,
        JSON.stringify({
          title: createStreamDto.title,
          sellerId: seller.id,
          productIds,
        }),
      );

      const livekitUrl = this.livekit.getLiveKitUrl();
      const publisherToken = await this.livekit.createPublisherToken(
        roomName,
        `seller-${userId}`,
      );

      await this.prisma.stream.update({
        where: { id: stream.id },
        data: { livekitRoomName: roomName, livekitUrl },
      });

      void this.tryStartStreamRecording(stream.id, roomName);

      this.logger.log(`Created LiveKit room for stream: ${stream.title}`);

      const updated = await this.prisma.stream.findUnique({
        where: { id: stream.id },
        include: streamWithSellerInclude,
      });

      if (updated) {
        this.queueNotifyBuyersLiveStarted(updated);
      }

      return {
        ...updated,
        token: publisherToken,
      };
    } catch (err: unknown) {
      const cause = err instanceof Error ? err.cause ?? err : err;
      const msg = cause instanceof Error ? cause.message : String(cause);
      const isUnreachable =
        msg.includes('ECONNREFUSED') ||
        msg.includes('fetch failed') ||
        msg.includes('ENOTFOUND');
      await this.prisma.stream.delete({ where: { id: stream.id } }).catch(() => {});
      if (isUnreachable) {
        throw new BadGatewayException(
          'LiveKit server is unreachable. Start the LiveKit server (see README or LIVEKIT-NATIVE-WINDOWS.md) and set LIVEKIT_URL in .env to that host (e.g. http://localhost:7880).',
        );
      }
      throw err;
    }
  }

  /** Schedule a future stream (no LiveKit room until seller starts live). */
  async scheduleStream(dto: ScheduleStreamDto, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }

    const startedAt = new Date(dto.scheduledAt);
    if (!(startedAt.getTime() > Date.now())) {
      throw new BadRequestException('Scheduled time must be in the future');
    }

    const productIds = dto.productIds;
    const sellerProducts = await this.prisma.product.findMany({
      where: { sellerId: seller.id, id: { in: productIds } },
      select: { id: true, images: true },
    });
    const byId = new Map(sellerProducts.map((p) => [p.id, p]));
    const invalid = productIds.filter((id) => !byId.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Products not found or not owned by you: ${invalid.join(', ')}`,
      );
    }
    const first = byId.get(productIds[0]);
    const thumbnailUrl = first?.images?.[0] ?? null;

    return this.prisma.stream.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        sellerId: seller.id,
        isLive: false,
        startedAt,
        thumbnailUrl,
        visibility: 'PUBLIC',
        streamProducts: {
          create: productIds.map((productId, index) => ({
            productId,
            sortOrder: index,
          })),
        },
      },
      include: streamWithSellerInclude,
    });
  }

  /** Activate a scheduled stream: create LiveKit room, mark live, return publisher token (same shape as create). */
  async startScheduledStream(streamId: string, userId: string) {
    if (!this.livekit.isConfigured()) {
      throw new BadRequestException(
        'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.',
      );
    }

    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: {
        seller: true,
        streamProducts: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!stream) {
      throw new NotFoundException(`Stream with ID ${streamId} not found`);
    }
    if (stream.seller.userId !== userId) {
      throw new ForbiddenException('You can only start your own streams');
    }
    if (stream.isLive) {
      throw new BadRequestException('Stream is already live');
    }
    if (stream.endedAt) {
      throw new BadRequestException('This stream has already ended');
    }
    const planned = stream.startedAt;
    if (!planned) {
      throw new BadRequestException('This stream has no scheduled start time');
    }

    const EARLY_MS = 15 * 60 * 1000;
    const LATE_MS = 4 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const plannedMs = planned.getTime();
    if (nowMs < plannedMs - EARLY_MS) {
      throw new BadRequestException(
        'You can start this live up to 15 minutes before the scheduled time',
      );
    }
    if (nowMs > plannedMs + LATE_MS) {
      throw new BadRequestException(
        'This scheduled live is outside the allowed start window',
      );
    }

    if (stream.livekitRoomName) {
      throw new BadRequestException(
        'This stream is already set up; refresh or contact support',
      );
    }

    const productIds = stream.streamProducts.map((sp) => sp.productId);
    const roomName = stream.id;

    try {
      await this.livekit.createRoom(
        roomName,
        JSON.stringify({
          title: stream.title,
          sellerId: stream.sellerId,
          productIds,
        }),
      );

      const livekitUrl = this.livekit.getLiveKitUrl();
      const publisherToken = await this.livekit.createPublisherToken(
        roomName,
        `seller-${userId}`,
      );

      const liveNow = new Date();
      const updated = await this.prisma.stream.update({
        where: { id: streamId },
        data: {
          isLive: true,
          startedAt: liveNow,
          sellerLiveHeartbeatAt: liveNow,
          livekitRoomName: roomName,
          livekitUrl,
        },
        include: streamWithSellerInclude,
      });

      void this.tryStartStreamRecording(streamId, roomName);

      this.logger.log(`Started scheduled stream as live: ${stream.title}`);

      this.queueNotifyBuyersLiveStarted(updated);

      return {
        ...updated,
        token: publisherToken,
      };
    } catch (err: unknown) {
      const cause = err instanceof Error ? err.cause ?? err : err;
      const msg = cause instanceof Error ? cause.message : String(cause);
      const isUnreachable =
        msg.includes('ECONNREFUSED') ||
        msg.includes('fetch failed') ||
        msg.includes('ENOTFOUND');
      if (isUnreachable) {
        throw new BadGatewayException(
          'LiveKit server is unreachable. Start the LiveKit server and set LIVEKIT_URL in .env.',
        );
      }
      throw err;
    }
  }

  async findAllActive(
    query?: PaginationQueryDto,
    categoryId?: string,
  ): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 20 } = query ?? {};
    const skip = (page - 1) * limit;
    const where: Prisma.StreamWhereInput = {
      isLive: true,
      endedAt: null,
    };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    const [raw, total] = await Promise.all([
      this.prisma.stream.findMany({
        where,
        include: streamWithSellerInclude,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.stream.count({ where }),
    ]);
    const data = await Promise.all(
      raw.map(async (s) => {
        let socketViewers = 0;
        try {
          socketViewers = await this.redis.scard(
            this.redis.streamViewersKey(s.id),
          );
        } catch {
          /* ignore redis errors for list payload */
        }
        const dbCount = s.viewCount ?? 0;
        return {
          ...s,
          viewCount: Math.max(dbCount, socketViewers),
        };
      }),
    );
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id },
      include: {
        seller: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        streamProducts: {
          include: { product: true },
          orderBy: { sortOrder: 'asc' },
        },
        category: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!stream) throw new NotFoundException(`Stream with ID ${id} not found`);
    const engagement = await this.getEngagementSummary(id);
    let socketViewers = 0;
    try {
      socketViewers = await this.redis.scard(this.redis.streamViewersKey(id));
    } catch {
      /* ignore */
    }
    const dbCount = stream.viewCount ?? 0;
    return {
      ...stream,
      engagement,
      viewCount: Math.max(dbCount, socketViewers),
    };
  }

  private async assertStreamOwnership(streamId: string, userId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: {
        seller: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    if (!stream)
      throw new NotFoundException(`Stream with ID ${streamId} not found`);
    if (stream.seller.userId !== userId) {
      throw new ForbiddenException('You can only modify your own streams');
    }
    return stream;
  }

  async update(id: string, dto: UpdateStreamDto, userId: string) {
    const stream = await this.assertStreamOwnership(id, userId);
    const sellerId = stream.sellerId;
    const wasLiveBefore = stream.isLive;

    if (dto.productIds !== undefined) {
      const productIds = dto.productIds;
      if (productIds.length < 1 || productIds.length > 3) {
        throw new BadRequestException(
          'Provide between 1 and 3 products for this stream',
        );
      }
      const sellerProducts = await this.prisma.product.findMany({
        where: { sellerId, id: { in: productIds } },
        select: { id: true, images: true },
      });
      const byId = new Map(sellerProducts.map((p) => [p.id, p]));
      const invalid = productIds.filter((pid) => !byId.has(pid));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Products not found or not owned by you: ${invalid.join(', ')}`,
        );
      }
      const first = byId.get(productIds[0]);
      const thumbFromProduct = first?.images?.[0] ?? null;

      let endLiveData: Prisma.StreamUpdateInput = {};
      if (wasLiveBefore && dto.isLive === false) {
        endLiveData = await this.finalizeLiveRecordingAndRoom({
          id: stream.id,
          livekitRoomName: stream.livekitRoomName,
          livekitEgressId: stream.livekitEgressId,
        });
        endLiveData.endedAt = new Date();
      }

      const updatedWithProducts = await this.prisma.stream.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.categoryId !== undefined
            ? {
                category: dto.categoryId
                  ? { connect: { id: dto.categoryId } }
                  : { disconnect: true },
              }
            : {}),
          ...(dto.visibility !== undefined
            ? {
                visibility:
                  dto.visibility === 'FOLLOWERS_ONLY'
                    ? 'FOLLOWERS_ONLY'
                    : 'PUBLIC',
              }
            : {}),
          ...(dto.scheduledAt !== undefined
            ? { startedAt: new Date(dto.scheduledAt) }
            : {}),
          ...(dto.isLive !== undefined ? { isLive: dto.isLive } : {}),
          thumbnailUrl: thumbFromProduct,
          streamProducts: {
            deleteMany: {},
            create: productIds.map((productId, index) => ({
              productId,
              sortOrder: index,
            })),
          },
          ...endLiveData,
        },
        include: streamWithSellerInclude,
      });
      if (wasLiveBefore && dto.isLive === false) {
        this.queueNotifyBuyersLiveEnded(updatedWithProducts);
      }
      return updatedWithProducts;
    }

    const data: Prisma.StreamUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.visibility !== undefined) {
      data.visibility =
        dto.visibility === 'FOLLOWERS_ONLY' ? 'FOLLOWERS_ONLY' : 'PUBLIC';
    }
    if (dto.thumbnailUrl !== undefined) data.thumbnailUrl = dto.thumbnailUrl;
    if (dto.scheduledAt !== undefined) {
      data.startedAt = new Date(dto.scheduledAt);
    }
    if (dto.isLive !== undefined) data.isLive = dto.isLive;
    if (wasLiveBefore && dto.isLive === false) {
      const endLiveData = await this.finalizeLiveRecordingAndRoom({
        id: stream.id,
        livekitRoomName: stream.livekitRoomName,
        livekitEgressId: stream.livekitEgressId,
      });
      Object.assign(data, endLiveData);
      data.endedAt = new Date();
    }
    const updated = await this.prisma.stream.update({
      where: { id },
      data,
      include: streamWithSellerInclude,
    });
    if (wasLiveBefore && dto.isLive === false) {
      this.queueNotifyBuyersLiveEnded(updated);
    }
    return updated;
  }

  async remove(id: string, userId: string) {
    const stream = await this.assertStreamOwnership(id, userId);
    const wasLive = stream.isLive;
    await this.finalizeLiveRecordingAndRoom({
      id: stream.id,
      livekitRoomName: stream.livekitRoomName,
      livekitEgressId: stream.livekitEgressId,
    });
    const deleted = await this.prisma.stream.delete({ where: { id } });
    if (wasLive) {
      this.queueNotifyBuyersLiveEnded(stream);
    }
    return deleted;
  }

  async stopStream(id: string, userId: string) {
    const stream = await this.assertStreamOwnership(id, userId);
    const wasLive = stream.isLive;
    const startedAt = stream.startedAt ?? stream.createdAt;
    const finalizePatch = await this.finalizeLiveRecordingAndRoom({
      id: stream.id,
      livekitRoomName: stream.livekitRoomName,
      livekitEgressId: stream.livekitEgressId,
    });
    const endedAt = new Date();
    const updated = await this.prisma.stream.update({
      where: { id },
      data: {
        isLive: false,
        endedAt,
        ...finalizePatch,
      },
      include: streamWithSellerInclude,
    });
    if (wasLive) {
      this.queueNotifyBuyersLiveEnded(updated);
    }
    const summary = await this.buildStreamEndSummary(
      id,
      startedAt,
      endedAt,
      stream.viewCount ?? 0,
    );
    return { ...updated, summary };
  }

  private async buildStreamEndSummary(
    streamId: string,
    startedAt: Date,
    endedAt: Date,
    viewCountAtStop: number,
  ) {
    const engagement = await this.getEngagementSummary(streamId);
    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const durationSeconds = Math.round(durationMs / 1000);
    const orderAgg = await this.prisma.order.aggregate({
      where: {
        streamId,
        createdAt: { gte: startedAt, lte: endedAt },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    return {
      durationSeconds,
      viewCount: viewCountAtStop,
      likes: engagement.likes,
      comments: engagement.comments,
      ordersPlaced: orderAgg._count._all,
      revenueTotal: orderAgg._sum.totalAmount ?? 0,
    };
  }

  /** Seller-only: current live stream for recovery UI. */
  async findSellerActiveLive(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!seller) return null;
    const stream = await this.prisma.stream.findFirst({
      where: {
        sellerId: seller.id,
        isLive: true,
        endedAt: null,
      },
      orderBy: { startedAt: 'desc' },
      include: streamWithSellerInclude,
    });
    if (!stream) {
      return { stream: null, recoverableUntil: null as string | null };
    }
    const engagement = await this.getEngagementSummary(stream.id);
    let socketViewers = 0;
    try {
      socketViewers = await this.redis.scard(
        this.redis.streamViewersKey(stream.id),
      );
    } catch {
      /* ignore */
    }
    const dbCount = stream.viewCount ?? 0;
    const lastBeat = stream.sellerLiveHeartbeatAt ?? stream.startedAt ?? stream.createdAt;
    const recoverableUntil = new Date(lastBeat.getTime() + 5 * 60 * 1000);
    return {
      stream: {
        ...stream,
        engagement,
        viewCount: Math.max(dbCount, socketViewers),
      },
      recoverableUntil: recoverableUntil.toISOString(),
    };
  }

  async touchSellerHeartbeat(streamId: string, userId: string) {
    await this.assertStreamOwnership(streamId, userId);
    const beat = new Date();
    await this.prisma.stream.update({
      where: { id: streamId },
      data: { sellerLiveHeartbeatAt: beat },
    });
    return { ok: true, sellerLiveHeartbeatAt: beat.toISOString() };
  }

  /** Single round-trip for live UI: engagement + viewCount + comments tail. */
  async getLiveState(streamId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        id: true,
        isLive: true,
        viewCount: true,
        title: true,
      },
    });
    if (!stream) throw new NotFoundException(`Stream with ID ${streamId} not found`);
    const engagement = await this.getEngagementSummary(streamId);
    let socketViewers = 0;
    try {
      socketViewers = await this.redis.scard(
        this.redis.streamViewersKey(streamId),
      );
    } catch {
      /* ignore */
    }
    const comments = await this.getComments(streamId);
    const tail = Array.isArray(comments)
      ? (comments as unknown[]).slice(-30)
      : [];
    return {
      streamId,
      isLive: stream.isLive,
      title: stream.title,
      viewCount: Math.max(stream.viewCount ?? 0, socketViewers),
      engagement,
      comments: tail,
    };
  }

  /**
   * Get a join token for a stream. Seller gets publisher token, others get subscriber token.
   */
  async getJoinToken(
    streamId: string,
    userId: string,
    identity: string,
  ): Promise<{ token: string; livekitUrl: string; roomName: string }> {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { seller: true },
    });
    if (!stream) throw new NotFoundException(`Stream ${streamId} not found`);
    if (!stream.isLive) {
      throw new BadRequestException('This stream is not live');
    }
    if (!stream.livekitRoomName || !stream.livekitUrl) {
      throw new BadRequestException('Stream does not have LiveKit configured');
    }

    const isOwner = stream.seller.userId === userId;
    if (isOwner) {
      const seller = await this.prisma.seller.findUnique({
        where: { userId },
        select: { status: true },
      });
      if (!seller || seller.status !== VerificationStatus.VERIFIED) {
        throw new ForbiddenException(
          'Your seller account must be verified before you can go live.',
        );
      }
    }
    const token = isOwner
      ? await this.livekit.createPublisherToken(
          stream.livekitRoomName,
          identity || `seller-${userId}`,
        )
      : await this.livekit.createSubscriberToken(
          stream.livekitRoomName,
          identity || `viewer-${userId}`,
        );

    if (!isOwner && stream.isLive) {
      const dedupeKey = `stream:viewer:join:${streamId}:${userId}`;
      const firstInWindow = await this.redis.setNx(dedupeKey, '1', 600);
      if (firstInWindow) {
        try {
          await this.prisma.stream.update({
            where: { id: streamId },
            data: { viewCount: { increment: 1 } },
          });
        } catch (e) {
          this.logger.warn(
            `viewCount increment failed for stream ${streamId}: ${String(e)}`,
          );
        }
      }
    }

    return {
      token,
      livekitUrl: stream.livekitUrl,
      roomName: stream.livekitRoomName,
    };
  }

  /**
   * Get a viewer (subscriber) token without auth. For local testing only.
   * Use GET /streams/:id/viewer-token?identity=viewer1
   */
  async getViewerToken(
    streamId: string,
    identity = 'viewer-1',
  ): Promise<{ token: string; wsUrl: string; roomName: string }> {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
    });
    if (!stream) throw new NotFoundException(`Stream ${streamId} not found`);
    if (!stream.isLive) {
      throw new BadRequestException('This stream is not live');
    }
    if (!stream.livekitRoomName || !stream.livekitUrl) {
      throw new BadRequestException('Stream does not have LiveKit configured');
    }
    const token = await this.livekit.createSubscriberToken(
      stream.livekitRoomName,
      identity,
    );

    if (stream.isLive) {
      const safeId = identity.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'viewer';
      const dedupeKey = `stream:viewer:join:${streamId}:${safeId}`;
      const firstInWindow = await this.redis.setNx(dedupeKey, '1', 600);
      if (firstInWindow) {
        try {
          await this.prisma.stream.update({
            where: { id: streamId },
            data: { viewCount: { increment: 1 } },
          });
        } catch (e) {
          this.logger.warn(
            `viewCount increment (viewer-token) failed for stream ${streamId}: ${String(e)}`,
          );
        }
      }
    }

    return {
      token,
      wsUrl: this.livekit.getWebSocketUrl(),
      roomName: stream.livekitRoomName,
    };
  }

  private async getEngagementSummary(streamId: string) {
    const [likesRaw, commentsRaw, bidsRaw] = await Promise.all([
      this.redis.get(this.likesKey(streamId)),
      this.redis.get(this.commentsKey(streamId)),
      this.redis.get(this.bidsKey(streamId)),
    ]);
    const likedBy: string[] = likesRaw ? JSON.parse(likesRaw) : [];
    const comments: Array<Record<string, unknown>> = commentsRaw
      ? JSON.parse(commentsRaw)
      : [];
    const bids: Array<{ amount: number }> = bidsRaw ? JSON.parse(bidsRaw) : [];
    const topBid = bids.length
      ? bids.reduce((max, x) => (x.amount > max ? x.amount : max), 0)
      : 0;
    return {
      likes: likedBy.length,
      comments: comments.length,
      bids: bids.length,
      topBid,
    };
  }

  async toggleLike(streamId: string, userId: string) {
    await this.findOne(streamId);
    const raw = await this.redis.get(this.likesKey(streamId));
    const likedBy: string[] = raw ? JSON.parse(raw) : [];
    const index = likedBy.indexOf(userId);
    let liked: boolean;
    if (index >= 0) {
      likedBy.splice(index, 1);
      liked = false;
    } else {
      likedBy.push(userId);
      liked = true;
    }
    await this.redis.set(this.likesKey(streamId), JSON.stringify(likedBy));
    return { liked, likes: likedBy.length };
  }

  async addComment(streamId: string, userId: string, text: string) {
    await this.findOne(streamId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    const raw = await this.redis.get(this.commentsKey(streamId));
    const comments: Array<Record<string, unknown>> = raw ? JSON.parse(raw) : [];
    const comment = {
      id: `cmt-${Date.now()}`,
      userId,
      userName: user?.name ?? 'user',
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    comments.push(comment);
    const latest = comments.slice(-50);
    await this.redis.set(this.commentsKey(streamId), JSON.stringify(latest));
    return comment;
  }

  async getComments(streamId: string) {
    await this.findOne(streamId);
    const raw = await this.redis.get(this.commentsKey(streamId));
    return raw ? JSON.parse(raw) : [];
  }

  async addBid(streamId: string, userId: string, amount: number) {
    await this.findOne(streamId);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Bid amount must be a positive number');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    const raw = await this.redis.get(this.bidsKey(streamId));
    const bids: Array<Record<string, unknown>> = raw ? JSON.parse(raw) : [];
    const bid = {
      id: `bid-${Date.now()}`,
      userId,
      userName: user?.name ?? 'user',
      amount,
      createdAt: new Date().toISOString(),
    };
    bids.push(bid);
    const latest = bids.slice(-100);
    await this.redis.set(this.bidsKey(streamId), JSON.stringify(latest));
    const topBid = latest.reduce(
      (max, x) => ((x.amount as number) > max ? (x.amount as number) : max),
      0,
    );
    return { bid, topBid };
  }

  async followSeller(streamId: string, userId: string) {
    const stream = await this.findOne(streamId);
    const sellerId = stream.seller?.id;
    if (!sellerId) throw new NotFoundException('Seller not found');
    const raw = await this.redis.get(this.followsKey(userId));
    const follows: string[] = raw ? JSON.parse(raw) : [];
    if (!follows.includes(sellerId)) follows.push(sellerId);
    await this.redis.set(this.followsKey(userId), JSON.stringify(follows));
    return { followed: true, sellerId };
  }

  async getStoreProducts(
    streamId: string,
    query?: {
      search?: string;
      sort?: 'best_seller' | 'auction' | 'sold';
      minPrice?: number;
      maxPrice?: number;
    },
  ) {
    const stream = await this.findOne(streamId);
    const sellerId = stream.seller?.id;
    if (!sellerId) throw new NotFoundException('Seller not found');

    const products = await this.prisma.product.findMany({
      where: {
        sellerId,
        status: 'ACTIVE',
        ...(query?.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
        ...(query?.minPrice != null || query?.maxPrice != null
          ? {
              price: {
                ...(query?.minPrice != null ? { gte: query.minPrice } : {}),
                ...(query?.maxPrice != null ? { lte: query.maxPrice } : {}),
              },
            }
          : {}),
      },
      orderBy:
        query?.sort === 'sold'
          ? { updatedAt: 'desc' }
          : query?.sort === 'auction'
            ? { price: 'desc' }
            : { createdAt: 'desc' },
      take: 60,
    });
    return {
      seller: stream.seller,
      streamId,
      products,
    };
  }

  /**
   * Ends streams stuck as `isLive` (e.g. app crash, lost disconnect). Keeps `/streams/active` honest.
   * Does not delete streams — same as seller stop: `isLive: false`, `endedAt` set, optional LiveKit room delete.
   * Set `DISABLE_ZOMBIE_STREAM_SWEEP=1` to turn off.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepZombieLiveStreams() {
    if (process.env.DISABLE_ZOMBIE_STREAM_SWEEP === '1') return;
    const now = Date.now();
    const maxLiveMs = 8 * 60 * 60 * 1000;
    const staleStart = new Date(now - maxLiveMs);
    const legacyCutoff = new Date(now - 24 * 60 * 60 * 1000);
    const orphanCutoff = new Date(now - 5 * 60 * 1000);
    const zombies = await this.prisma.stream.findMany({
      where: {
        isLive: true,
        endedAt: null,
        OR: [
          { sellerLiveHeartbeatAt: { lt: orphanCutoff } },
          {
            sellerLiveHeartbeatAt: null,
            startedAt: { lt: orphanCutoff },
          },
          { startedAt: { lt: staleStart } },
          { startedAt: null, createdAt: { lt: legacyCutoff } },
        ],
      },
      include: streamWithSellerInclude,
    });
    if (zombies.length === 0) return;
    this.logger.log(
      `Zombie stream sweep: ending ${zombies.length} stale live stream(s)`,
    );
    for (const s of zombies) {
      try {
        const finalizePatch = await this.finalizeLiveRecordingAndRoom({
          id: s.id,
          livekitRoomName: s.livekitRoomName,
          livekitEgressId: s.livekitEgressId,
        });
        const updated = await this.prisma.stream.update({
          where: { id: s.id },
          data: {
            isLive: false,
            endedAt: new Date(),
            ...finalizePatch,
          },
          include: streamWithSellerInclude,
        });
        this.queueNotifyBuyersLiveEnded(updated, { notifyBuyers: false });
      } catch (e) {
        this.logger.warn(
          `Zombie sweep failed for stream ${s.id}: ${String(e)}`,
        );
      }
    }
  }
}