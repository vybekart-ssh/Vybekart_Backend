import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { CreateStreamDto } from './dto/create-stream.dto';
import { UpdateStreamDto } from './dto/update-stream.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { LiveKitService } from '../livekit/livekit.service';
import { RedisService } from '../redis/redis.service';

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
  ) {}

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
    if (productIds.length > 0) {
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

    const stream = await this.prisma.stream.create({
      data: {
        title: createStreamDto.title,
        description: createStreamDto.description,
        categoryId: createStreamDto.categoryId ?? null,
        visibility,
        sellerId: seller.id,
        isLive: true,
        startedAt: new Date(),
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

      this.logger.log(`Created LiveKit room for stream: ${stream.title}`);

      const updated = await this.prisma.stream.findUnique({
        where: { id: stream.id },
        include: streamWithSellerInclude,
      });

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

  async findAllActive(
    query?: PaginationQueryDto,
    categoryId?: string,
  ): Promise<PaginatedResult<unknown>> {
    const { page = 1, limit = 20 } = query ?? {};
    const skip = (page - 1) * limit;
    const where: any = { isLive: true };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    const [data, total] = await Promise.all([
      this.prisma.stream.findMany({
        where,
        include: streamWithSellerInclude,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.stream.count({ where }),
    ]);
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
    return { ...stream, engagement };
  }

  private async assertStreamOwnership(streamId: string, userId: string) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { seller: true },
    });
    if (!stream)
      throw new NotFoundException(`Stream with ID ${streamId} not found`);
    if (stream.seller.userId !== userId) {
      throw new ForbiddenException('You can only modify your own streams');
    }
    return stream;
  }

  async update(id: string, updateStreamDto: UpdateStreamDto, userId: string) {
    await this.assertStreamOwnership(id, userId);
    return this.prisma.stream.update({
      where: { id },
      data: updateStreamDto,
    });
  }

  async remove(id: string, userId: string) {
    const stream = await this.assertStreamOwnership(id, userId);
    if (stream.livekitRoomName) {
      await this.livekit.deleteRoom(stream.livekitRoomName);
    }
    return this.prisma.stream.delete({ where: { id } });
  }

  async stopStream(id: string, userId: string) {
    const stream = await this.assertStreamOwnership(id, userId);
    if (stream.livekitRoomName) {
      await this.livekit.deleteRoom(stream.livekitRoomName);
    }
    return this.prisma.stream.update({
      where: { id },
      data: {
        isLive: false,
        endedAt: new Date(),
      },
    });
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
    if (!stream.livekitRoomName || !stream.livekitUrl) {
      throw new BadRequestException('Stream does not have LiveKit configured');
    }

    const isOwner = stream.seller.userId === userId;
    const token = isOwner
      ? await this.livekit.createPublisherToken(
          stream.livekitRoomName,
          identity || `seller-${userId}`,
        )
      : await this.livekit.createSubscriberToken(
          stream.livekitRoomName,
          identity || `viewer-${userId}`,
        );

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
    if (!stream.livekitRoomName || !stream.livekitUrl) {
      throw new BadRequestException('Stream does not have LiveKit configured');
    }
    const token = await this.livekit.createSubscriberToken(
      stream.livekitRoomName,
      identity,
    );
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
}