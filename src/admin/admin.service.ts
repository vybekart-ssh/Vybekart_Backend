import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CouponDiscountType,
  Prisma,
  StreamReplayStatus,
  StreamVisibility,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SellersService } from '../sellers/sellers.service';
import { AppConfigService } from '../app-config/app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';
import { RequestSellerChangesDto } from './dto/request-seller-changes.dto';
import {
  assertYoutubeVideoId,
  CreatePromoVideoDto,
  UpdatePromoVideoDto,
  youtubeThumbnailUrl,
} from './dto/promo-video.dto';
import {
  assertCouponDiscountShape,
  CreateCouponDto,
  normalizeCouponCode,
  UpdateCouponDto,
} from './dto/coupon.dto';
import {
  assertDirectReplayUrl,
  CreateArchiveFromUrlDto,
} from './dto/create-archive-from-url.dto';
import { RatingsService } from '../ratings/ratings.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  ARCHIVE_RETENTION_OPTIONS,
  DEFAULT_ARCHIVE_RETENTION_HOURS,
  computeArchiveExpiresAt,
  normalizeArchiveRetentionHours,
} from '../streams/archive-retention.util';
import { randomUUID } from 'crypto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private sellersService: SellersService,
    private appConfig: AppConfigService,
    private ratings: RatingsService,
    private supabase: SupabaseStorageService,
    private config: ConfigService,
  ) {}

  listSellers(status?: VerificationStatus) {
    return this.sellersService.findAllForAdmin(status);
  }

  getSellerDetail(sellerId: string) {
    return this.sellersService.findOneSellerForAdmin(sellerId);
  }

  approveSeller(sellerId: string) {
    return this.sellersService.approve(sellerId);
  }

  rejectSeller(sellerId: string, reason?: string) {
    return this.sellersService.reject(sellerId, reason ?? '');
  }

  requestSellerChanges(input: {
    sellerId: string;
    adminUserId: string;
    dto: RequestSellerChangesDto;
  }) {
    return this.sellersService.requestChanges({
      sellerId: input.sellerId,
      adminUserId: input.adminUserId,
      sections: input.dto.sections,
      note: input.dto.note,
    });
  }

  reregisterSeller(sellerId: string) {
    return this.sellersService.reregisterSeller(sellerId);
  }

  getAppConfig() {
    return this.appConfig.getPublicAndroid();
  }

  async patchAppConfig(dto: UpdateAppConfigDto) {
    const hasUpdate =
      dto.minAndroidVersionCode !== undefined ||
      dto.latestAndroidVersionName !== undefined ||
      dto.productGstPriceThresholdInr !== undefined ||
      dto.productGstPercentBelow !== undefined ||
      dto.productGstPercentAtOrAbove !== undefined ||
      dto.shippingPayer !== undefined;
    if (!hasUpdate) {
      return this.appConfig.getPublicAndroid();
    }
    await this.appConfig.updateAndroidConfig({
      minAndroidVersionCode: dto.minAndroidVersionCode,
      latestAndroidVersionName: dto.latestAndroidVersionName,
      productGstPriceThresholdInr: dto.productGstPriceThresholdInr,
      productGstPercentBelow: dto.productGstPercentBelow,
      productGstPercentAtOrAbove: dto.productGstPercentAtOrAbove,
      shippingPayer: dto.shippingPayer,
    });
    return this.appConfig.getPublicAndroid();
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, roles: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async listBuyers(q?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.BuyerWhereInput = q?.trim()
      ? {
          user: {
            OR: [
              { name: { contains: q.trim(), mode: 'insensitive' } },
              { email: { contains: q.trim(), mode: 'insensitive' } },
              { phone: { contains: q.trim(), mode: 'insensitive' } },
            ],
          },
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.buyer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
          rating: true,
          _count: { select: { replacementRequests: true } },
        },
      }),
      this.prisma.buyer.count({ where }),
    ]);

    return {
      items: items.map((b) => ({
        buyerId: b.id,
        userId: b.userId,
        name: b.user.name,
        email: b.user.email,
        phone: b.user.phone,
        createdAt: b.user.createdAt,
        score: b.rating?.score ?? 5,
        replacementCount: b._count.replacementRequests,
      })),
      total,
      page,
      limit,
    };
  }

  async getBuyerDetail(buyerId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
            isActive: true,
          },
        },
        rating: true,
        replacementRequests: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { order: { select: { id: true, status: true, totalAmount: true } } },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: {
            items: {
              include: {
                product: {
                  include: { seller: { select: { businessName: true } } },
                },
              },
            },
          },
        },
        follows: {
          include: {
            seller: {
              select: {
                id: true,
                businessName: true,
                logoUrl: true,
              },
            },
          },
        },
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');

    const user = buyer.user;
    const addresses = await this.prisma.address.findMany({
      where: { userId: user.id, type: 'SHIPPING' },
    });
    const supportTickets = await this.prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const lastOrder = buyer.orders[0];
    const lastReplacement = buyer.replacementRequests[0];

    return {
      buyer: {
        id: buyer.id,
        user,
        rating: buyer.rating,
      },
      replacements: buyer.replacementRequests,
      orders: buyer.orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        sellerName: o.items[0]?.product?.seller?.businessName ?? null,
      })),
      addresses,
      following: buyer.follows.map((f) => f.seller),
      supportTickets,
      activity: {
        lastOrderAt: lastOrder?.createdAt ?? null,
        lastReplacementAt: lastReplacement?.createdAt ?? null,
      },
    };
  }

  async listSellerDirectory(q?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.SellerWhereInput = q?.trim()
      ? {
          OR: [
            { businessName: { contains: q.trim(), mode: 'insensitive' } },
            {
              user: {
                OR: [
                  { email: { contains: q.trim(), mode: 'insensitive' } },
                  { phone: { contains: q.trim(), mode: 'insensitive' } },
                  { name: { contains: q.trim(), mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              name: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
          rating: true,
        },
      }),
      this.prisma.seller.count({ where }),
    ]);

    const mapped = await Promise.all(
      items.map(async (s) => ({
        sellerId: s.id,
        businessName: s.businessName,
        status: s.status,
        ownerName: s.user.name,
        email: s.user.email,
        phone: s.user.phone,
        createdAt: s.user.createdAt,
        overall: s.rating?.overall ?? 5,
        replacementPercent: await this.ratings.getSellerReplacementPercent(s.id),
      })),
    );

    return { items: mapped, total, page, limit };
  }

  getSellerUserDetail(sellerId: string) {
    return this.getSellerDetail(sellerId);
  }

  async listPackingVideos(filter?: { sellerId?: string }) {
    const orders = await this.prisma.order.findMany({
      where: {
        packingVideoUrl: { not: null },
        ...(filter?.sellerId
          ? {
              items: {
                some: { product: { sellerId: filter.sellerId } },
              },
            }
          : {}),
      },
      orderBy: { packedAt: 'desc' },
      include: {
        items: { include: { product: { include: { seller: true } } } },
      },
      take: 200,
    });

    return orders.map((o) => {
      const seller = o.items[0]?.product?.seller ?? null;
      return {
        orderId: o.id,
        packedAt: o.packedAt?.toISOString() ?? null,
        packingVideoUrl: o.packingVideoUrl,
        streamId: o.streamId,
        seller: seller
          ? { id: seller.id, businessName: seller.businessName, userId: seller.userId }
          : null,
      };
    });
  }

  private replayBucket(): string {
    return (
      this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET')?.trim() ||
      this.supabase.publicBucket()
    );
  }

  private extractObjectKeyFromPublicUrl(url: string): string | null {
    const marker = '/storage/v1/object/public/';
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    const rest = url.slice(idx + marker.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    return decodeURIComponent(rest.slice(slash + 1));
  }

  private mapArchiveRow(s: {
    id: string;
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
    viewCount: number;
    replayUrl: string | null;
    replayDurationSec: number | null;
    replayStatus: StreamReplayStatus;
    archiveRetentionHours: number;
    archiveExpiresAt: Date | null;
    isAdminUploaded: boolean;
    isLive: boolean;
    seller: {
      id: string;
      businessName: string;
      logoUrl?: string | null;
      user: { name: string | null; email: string | null } | null;
    };
    streamProducts?: { productId: string; sortOrder: number; product?: { id: string; name: string; price: number; images: string[] } }[];
  }) {
    const logoUrl = s.seller.logoUrl?.trim() || null;
    const products = (s.streamProducts ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        id: sp.product?.id ?? sp.productId,
        name: sp.product?.name ?? 'Product',
        price: sp.product?.price ?? 0,
        imageUrl: sp.product?.images?.[0] ?? null,
      }));
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      thumbnailUrl: s.thumbnailUrl?.trim() || products[0]?.imageUrl || logoUrl,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      viewCount: s.viewCount,
      replayUrl: s.replayUrl,
      replayDurationSec: s.replayDurationSec,
      replayStatus: s.replayStatus,
      archiveRetentionHours: s.archiveRetentionHours,
      archiveExpiresAt: s.archiveExpiresAt?.toISOString() ?? null,
      isAdminUploaded: s.isAdminUploaded,
      isLive: s.isLive,
      productIds: products.map((p) => p.id),
      products,
      seller: {
        id: s.seller.id,
        businessName: s.seller.businessName,
        logoUrl,
        ownerName: s.seller.user?.name ?? null,
        email: s.seller.user?.email ?? null,
      },
    };
  }

  private archiveSellerInclude() {
    return {
      select: {
        id: true,
        businessName: true,
        logoUrl: true,
        user: { select: { name: true, email: true } },
      },
    } as const;
  }

  private archiveProductsInclude() {
    return {
      orderBy: { sortOrder: 'asc' as const },
      select: {
        productId: true,
        sortOrder: true,
        product: {
          select: { id: true, name: true, price: true, images: true },
        },
      },
    };
  }

  /** Replace stream products for an archive; productIds must belong to sellerId. */
  private async setArchiveProducts(streamId: string, sellerId: string, productIds: string[]) {
    const unique = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length > 300) {
      throw new BadRequestException('Provide at most 300 products for this archive');
    }
    if (unique.length === 0) {
      await this.prisma.streamProduct.deleteMany({ where: { streamId } });
      return;
    }
    const found = await this.prisma.product.findMany({
      where: { sellerId, id: { in: unique } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((p) => p.id));
    const invalid = unique.filter((id) => !foundIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Products not found or not owned by seller: ${invalid.slice(0, 5).join(', ')}`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.streamProduct.deleteMany({ where: { streamId } }),
      this.prisma.streamProduct.createMany({
        data: unique.map((productId, index) => ({
          streamId,
          productId,
          sortOrder: index,
        })),
      }),
    ]);
  }

  retentionOptions() {
    return ARCHIVE_RETENTION_OPTIONS;
  }

  async listSellerProductsForArchive(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    const products = await this.prisma.product.findMany({
      where: {
        sellerId,
        status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        status: true,
        stock: true,
      },
    });
    return {
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        imageUrl: p.images?.[0] ?? null,
        status: p.status,
        stock: p.stock,
      })),
    };
  }

  async listArchives(filter?: { sellerId?: string; q?: string }) {
    const q = filter?.q?.trim();
    const rows = await this.prisma.stream.findMany({
      where: {
        isLive: false,
        endedAt: { not: null },
        OR: [
          { replayUrl: { not: null } },
          { replayStatus: { in: [StreamReplayStatus.READY, StreamReplayStatus.RECORDING, StreamReplayStatus.FAILED] } },
          { isAdminUploaded: true },
        ],
        ...(filter?.sellerId ? { sellerId: filter.sellerId } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { seller: { businessName: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: { endedAt: 'desc' },
      take: 100,
      include: {
        seller: this.archiveSellerInclude(),
        streamProducts: this.archiveProductsInclude(),
      },
    });
    return {
      items: rows.map((s) => this.mapArchiveRow(s)),
      retentionOptions: ARCHIVE_RETENTION_OPTIONS,
    };
  }

  async getArchive(id: string) {
    const s = await this.prisma.stream.findUnique({
      where: { id },
      include: {
        seller: this.archiveSellerInclude(),
        streamProducts: this.archiveProductsInclude(),
      },
    });
    if (!s || !s.endedAt) throw new NotFoundException('Archive not found');
    return this.mapArchiveRow(s);
  }

  async createArchiveFromUpload(input: {
    sellerId: string;
    title?: string;
    description?: string;
    retentionHours?: number;
    startedAt?: string;
    endedAt?: string;
    durationSec?: number;
    productIds?: string[];
    video: { buffer: Buffer; mimetype: string; originalname: string };
    thumbnail?: { buffer: Buffer; mimetype: string } | null;
  }) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: input.sellerId },
      select: { id: true, businessName: true, logoUrl: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const streamId = randomUUID();
    const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
    const startedAt = input.startedAt
      ? new Date(input.startedAt)
      : new Date(endedAt.getTime() - 20 * 60 * 1000);
    const hours = normalizeArchiveRetentionHours(
      input.retentionHours ?? DEFAULT_ARCHIVE_RETENTION_HOURS,
    );
    const archiveExpiresAt = computeArchiveExpiresAt(endedAt, hours);

    const bucket = this.replayBucket();
    const objectKey = `vybekart-replays/${streamId}.mp4`;
    const contentType =
      input.video.mimetype?.trim() || 'video/mp4';
    const uploaded = await this.supabase.uploadPublicObject({
      bucket,
      objectKey,
      contentType,
      bytes: input.video.buffer,
      upsert: true,
    });

    let thumbnailUrl: string | null = null;
    if (input.thumbnail?.buffer?.length) {
      const ext =
        input.thumbnail.mimetype?.includes('png')
          ? 'png'
          : input.thumbnail.mimetype?.includes('webp')
            ? 'webp'
            : 'jpg';
      const thumbKey = `vybekart-replays/thumbs/${streamId}.${ext}`;
      const thumb = await this.supabase.uploadPublicObject({
        bucket,
        objectKey: thumbKey,
        contentType: input.thumbnail.mimetype || 'image/jpeg',
        bytes: input.thumbnail.buffer,
        upsert: true,
      });
      thumbnailUrl = thumb.publicUrl;
    } else {
      // Admin uploads often have no thumb — use store logo so cards aren't blank.
      thumbnailUrl = seller.logoUrl?.trim() || null;
    }

    const created = await this.prisma.stream.create({
      data: {
        id: streamId,
        title:
          input.title?.trim() ||
          `${seller.businessName} live archive`,
        description: input.description?.trim() || null,
        isLive: false,
        visibility: StreamVisibility.PUBLIC,
        sellerId: seller.id,
        startedAt,
        endedAt,
        replayUrl: uploaded.publicUrl,
        replayStatus: StreamReplayStatus.READY,
        replayDurationSec: input.durationSec ?? null,
        archiveRetentionHours: hours,
        archiveExpiresAt,
        isAdminUploaded: true,
        thumbnailUrl,
      },
      include: {
        seller: this.archiveSellerInclude(),
        streamProducts: this.archiveProductsInclude(),
      },
    });

    if (input.productIds?.length) {
      await this.setArchiveProducts(streamId, seller.id, input.productIds);
      return this.getArchive(streamId);
    }
    return this.mapArchiveRow(created);
  }

  async createArchiveFromUrl(input: CreateArchiveFromUrlDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: input.sellerId.trim() },
      select: { id: true, businessName: true, logoUrl: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const replayUrl = assertDirectReplayUrl(input.replayUrl);
    const streamId = randomUUID();
    const endedAt = input.endedAt ? new Date(input.endedAt) : new Date();
    const startedAt = input.startedAt
      ? new Date(input.startedAt)
      : new Date(endedAt.getTime() - 20 * 60 * 1000);
    const hours = normalizeArchiveRetentionHours(
      input.retentionHours ?? DEFAULT_ARCHIVE_RETENTION_HOURS,
    );
    const archiveExpiresAt = computeArchiveExpiresAt(endedAt, hours);
    const thumbnailUrl =
      input.thumbnailUrl?.trim() || seller.logoUrl?.trim() || null;

    const created = await this.prisma.stream.create({
      data: {
        id: streamId,
        title:
          input.title?.trim() ||
          `${seller.businessName} live archive`,
        description: input.description?.trim() || null,
        isLive: false,
        visibility: StreamVisibility.PUBLIC,
        sellerId: seller.id,
        startedAt,
        endedAt,
        replayUrl,
        replayStatus: StreamReplayStatus.READY,
        replayDurationSec: input.durationSec ?? null,
        archiveRetentionHours: hours,
        archiveExpiresAt,
        isAdminUploaded: true,
        thumbnailUrl,
      },
      include: {
        seller: this.archiveSellerInclude(),
        streamProducts: this.archiveProductsInclude(),
      },
    });

    if (input.productIds?.length) {
      await this.setArchiveProducts(streamId, seller.id, input.productIds);
      return this.getArchive(streamId);
    }
    return this.mapArchiveRow(created);
  }

  async updateArchive(
    id: string,
    input: {
      sellerId?: string;
      title?: string;
      description?: string;
      retentionHours?: number;
      startedAt?: string;
      endedAt?: string;
      durationSec?: number | null;
      thumbnailUrl?: string | null;
      productIds?: string[];
    },
  ) {
    const existing = await this.prisma.stream.findUnique({
      where: { id },
      include: { seller: { select: { id: true, logoUrl: true } } },
    });
    if (!existing || !existing.endedAt) {
      throw new NotFoundException('Archive not found');
    }
    const nextSellerId = input.sellerId?.trim() || existing.sellerId;
    if (input.sellerId) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: input.sellerId },
        select: { id: true, logoUrl: true },
      });
      if (!seller) throw new NotFoundException('Seller not found');
    }

    const endedAt = input.endedAt ? new Date(input.endedAt) : existing.endedAt;
    const hours =
      input.retentionHours !== undefined
        ? normalizeArchiveRetentionHours(input.retentionHours)
        : existing.archiveRetentionHours;
    // When admin changes retention, count from now so "48 hours" means
    // remain active for the next 48 hours (not from the original endedAt).
    const expiryBase =
      input.retentionHours !== undefined
        ? new Date(Math.max(endedAt.getTime(), Date.now()))
        : endedAt;

    let thumbnailUrl = input.thumbnailUrl;
    if (thumbnailUrl === undefined && !existing.thumbnailUrl?.trim()) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: nextSellerId },
        select: { logoUrl: true },
      });
      thumbnailUrl = seller?.logoUrl?.trim() || null;
    }

    const data: Prisma.StreamUpdateInput = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.sellerId
        ? { seller: { connect: { id: input.sellerId } } }
        : {}),
      ...(input.startedAt
        ? { startedAt: new Date(input.startedAt) }
        : {}),
      endedAt,
      archiveRetentionHours: hours,
      archiveExpiresAt: computeArchiveExpiresAt(expiryBase, hours),
      ...(input.durationSec !== undefined
        ? { replayDurationSec: input.durationSec }
        : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
    };

    await this.prisma.stream.update({
      where: { id },
      data,
    });

    if (input.productIds !== undefined) {
      await this.setArchiveProducts(id, nextSellerId, input.productIds);
    }

    return this.getArchive(id);
  }

  async deleteArchive(id: string) {
    const existing = await this.prisma.stream.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Archive not found');
    if (existing.isLive) {
      throw new BadRequestException('Cannot delete a live stream from archives');
    }

    const bucket = this.replayBucket();
    const keys: string[] = [];
    if (existing.replayUrl?.trim()) {
      const key = this.extractObjectKeyFromPublicUrl(existing.replayUrl);
      if (key) {
        keys.push(key);
      } else if (existing.replayUrl.includes('vybekart-replays/')) {
        // Legacy uploaded object path when public URL parsing fails.
        keys.push(`vybekart-replays/${id}.mp4`);
      }
      // External CDN/link archives: do not attempt Supabase deletes.
    }
    if (existing.thumbnailUrl?.trim()) {
      const tKey = this.extractObjectKeyFromPublicUrl(existing.thumbnailUrl);
      if (tKey) keys.push(tKey);
    }
    if (keys.length > 0) {
      await this.supabase.tryDeleteMany(bucket, keys);
    }

    await this.prisma.stream.delete({ where: { id } });
    return { deleted: true, id };
  }

  listPromoVideos() {
    return this.prisma.promoVideo.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createPromoVideo(dto: CreatePromoVideoDto) {
    const youtubeVideoId = assertYoutubeVideoId(dto.youtubeUrl);
    const youtubeUrl = dto.youtubeUrl.trim();
    return this.prisma.promoVideo.create({
      data: {
        title: dto.title.trim(),
        youtubeUrl,
        youtubeVideoId,
        thumbnailUrl: youtubeThumbnailUrl(youtubeVideoId),
        description: dto.description?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updatePromoVideo(id: string, dto: UpdatePromoVideoDto) {
    const existing = await this.prisma.promoVideo.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promo video not found');

    let youtubeVideoId = existing.youtubeVideoId;
    let youtubeUrl = existing.youtubeUrl;
    let thumbnailUrl = existing.thumbnailUrl;
    if (dto.youtubeUrl != null && dto.youtubeUrl.trim()) {
      youtubeVideoId = assertYoutubeVideoId(dto.youtubeUrl);
      youtubeUrl = dto.youtubeUrl.trim();
      thumbnailUrl = youtubeThumbnailUrl(youtubeVideoId);
    }

    return this.prisma.promoVideo.update({
      where: { id },
      data: {
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        ...(dto.youtubeUrl != null ? { youtubeUrl, youtubeVideoId, thumbnailUrl } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.sortOrder != null ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deletePromoVideo(id: string) {
    const existing = await this.prisma.promoVideo.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promo video not found');
    await this.prisma.promoVideo.delete({ where: { id } });
    return { deleted: true, id };
  }

  listCoupons() {
    return this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoupon(dto: CreateCouponDto) {
    const code = normalizeCouponCode(dto.code);
    if (!code) throw new BadRequestException('Coupon code is required');
    assertCouponDiscountShape({
      discountType: dto.discountType,
      discountValue: dto.discountValue,
    });

    const duplicate = await this.prisma.coupon.findUnique({ where: { code } });
    if (duplicate) {
      throw new BadRequestException(`Coupon code "${code}" already exists`);
    }

    return this.prisma.coupon.create({
      data: {
        code,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        visibility: dto.visibility,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        maxDiscountAmount:
          dto.discountType === CouponDiscountType.PERCENT
            ? (dto.maxDiscountAmount ?? null)
            : null,
        minOrderAmount: dto.minOrderAmount ?? 0,
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      },
    });
  }

  async updateCoupon(id: string, dto: UpdateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found');

    let code = existing.code;
    if (dto.code != null) {
      code = normalizeCouponCode(dto.code);
      if (!code) throw new BadRequestException('Coupon code is required');
      if (code !== existing.code) {
        const duplicate = await this.prisma.coupon.findUnique({
          where: { code },
        });
        if (duplicate) {
          throw new BadRequestException(`Coupon code "${code}" already exists`);
        }
      }
    }

    const discountType = dto.discountType ?? existing.discountType;
    const discountValue = dto.discountValue ?? existing.discountValue;
    assertCouponDiscountShape({ discountType, discountValue });

    const maxDiscountAmount =
      dto.maxDiscountAmount !== undefined
        ? dto.maxDiscountAmount
        : existing.maxDiscountAmount;

    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...(dto.code != null ? { code } : {}),
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.visibility != null ? { visibility: dto.visibility } : {}),
        ...(dto.discountType != null ? { discountType: dto.discountType } : {}),
        ...(dto.discountValue != null
          ? { discountValue: dto.discountValue }
          : {}),
        maxDiscountAmount:
          discountType === CouponDiscountType.PERCENT
            ? maxDiscountAmount
            : null,
        ...(dto.minOrderAmount != null
          ? { minOrderAmount: dto.minOrderAmount }
          : {}),
        ...(dto.isActive != null ? { isActive: dto.isActive } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
      },
    });
  }

  async deleteCoupon(id: string) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found');
    if (existing.redeemedAt != null) {
      throw new BadRequestException(
        'Cannot delete a coupon that has already been redeemed',
      );
    }
    await this.prisma.coupon.delete({ where: { id } });
    return { deleted: true, id };
  }
}
