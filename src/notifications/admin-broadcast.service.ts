import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { NotificationCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { FirebasePushService } from './firebase-push.service';

export const ADMIN_BROADCAST_AUDIENCES = [
  'SELECTED',
  'ALL_SELLERS',
  'ALL_BUYERS',
  'ALL_USERS',
] as const;
export type AdminBroadcastAudience = (typeof ADMIN_BROADCAST_AUDIENCES)[number];

/** Android channel for admin announcements (created by the app on start). */
export const ANDROID_ANNOUNCEMENTS_CHANNEL = 'vybekart_announcements';

const TITLE_MAX = 120;
const BODY_MAX = 500;
const MAX_SELECTED_USERS = 1000;
const INBOX_BATCH = 1000;
const REQUEST_DEDUPE_SECONDS = 10 * 60;

const SELLER_USER: Prisma.UserWhereInput = { sellerProfile: { isNot: null } };
const BUYER_USER: Prisma.UserWhereInput = { buyerProfile: { isNot: null } };

@Injectable()
export class AdminBroadcastService {
  private readonly logger = new Logger(AdminBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebasePushService,
    private readonly redis: RedisService,
  ) {}

  /** Seller partners / buyers for the admin recipient picker. */
  async searchRecipients(params: { q?: string; role?: string; limit?: number }) {
    const q = params.q?.trim();
    const role = params.role?.trim().toUpperCase();
    const limit = Math.min(Math.max(params.limit ?? 30, 1), 50);
    const and: Prisma.UserWhereInput[] = [
      role === 'SELLER' ? SELLER_USER : role === 'BUYER' ? BUYER_USER : { OR: [SELLER_USER, BUYER_USER] },
    ];
    if (q) {
      const contains = { contains: q, mode: 'insensitive' as const };
      and.push({
        OR: [
          { name: contains },
          { email: contains },
          { phone: contains },
          { sellerProfile: { is: { businessName: contains } } },
        ],
      });
    }
    const users = await this.prisma.user.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        sellerProfile: { select: { businessName: true } },
        buyerProfile: { select: { id: true } },
        _count: { select: { pushDevices: true } },
      },
    });
    return {
      items: users.map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        businessName: u.sellerProfile?.businessName ?? null,
        isSeller: u.sellerProfile != null,
        isBuyer: u.buyerProfile != null,
        hasDevice: u._count.pushDevices > 0,
      })),
    };
  }

  async listHistory(limit = 30) {
    const items = await this.prisma.adminBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return { items };
  }

  async send(input: {
    audience: string;
    userIds?: string[];
    title?: string;
    body?: string;
    imageUrl?: string;
    clientRequestId?: string;
    sentByUserId: string;
  }) {
    const audience = input.audience?.trim().toUpperCase() as AdminBroadcastAudience;
    if (!ADMIN_BROADCAST_AUDIENCES.includes(audience)) {
      throw new BadRequestException('Choose who should receive this notification');
    }
    const title = (input.title?.trim() || 'Vybekart').slice(0, TITLE_MAX);
    const body = (input.body?.trim() ?? '').slice(0, BODY_MAX);
    const imageUrl = input.imageUrl?.trim() || undefined;
    if (!body && !imageUrl) {
      throw new BadRequestException('Add a message or an image');
    }
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
      throw new BadRequestException('Image must be an https URL');
    }
    const userIds = [...new Set((input.userIds ?? []).map((id) => id?.trim()).filter(Boolean))];
    if (audience === 'SELECTED') {
      if (userIds.length === 0) throw new BadRequestException('Select at least one user');
      if (userIds.length > MAX_SELECTED_USERS) {
        throw new BadRequestException(`Select at most ${MAX_SELECTED_USERS} users, or use an "All" option`);
      }
    }

    // A double tap / retry of the same request must not notify everyone twice.
    const requestId = input.clientRequestId?.trim();
    if (requestId) {
      const first = await this.redis
        .setNx(`push:admin-broadcast:${requestId}`, '1', REQUEST_DEDUPE_SECONDS)
        .catch(() => true);
      if (!first) throw new ConflictException('This notification was already sent');
    }

    const where: Prisma.UserWhereInput =
      audience === 'SELECTED'
        ? { id: { in: userIds } }
        : audience === 'ALL_SELLERS'
          ? SELLER_USER
          : audience === 'ALL_BUYERS'
            ? BUYER_USER
            : { OR: [SELLER_USER, BUYER_USER] };

    const [recipientCount, devices, buyers] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.userPushDevice.findMany({ where: { user: where }, select: { fcmToken: true } }),
      this.prisma.buyer.findMany({ where: { user: where }, select: { id: true } }),
    ]);
    const tokens = [...new Set(devices.map((d) => d.fcmToken).filter((t) => t?.trim()))];

    const broadcast = await this.prisma.adminBroadcast.create({
      data: {
        audience,
        title,
        body,
        imageUrl: imageUrl ?? null,
        recipientCount,
        deviceCount: tokens.length,
        sentByUserId: input.sentByUserId,
      },
    });

    const result = await this.firebase.sendToTokensBatched(
      tokens,
      title,
      body,
      {
        type: 'ADMIN_BROADCAST',
        broadcastId: broadcast.id,
        title,
        body,
        imageUrl: imageUrl ?? '',
      },
      {
        android: {
          channelId: ANDROID_ANNOUNCEMENTS_CHANNEL,
          tag: `admin:${broadcast.id}`,
          imageUrl,
        },
      },
    );

    // Buyers also see it in their in-app notifications list.
    for (let i = 0; i < buyers.length; i += INBOX_BATCH) {
      await this.prisma.notification
        .createMany({
          data: buyers.slice(i, i + INBOX_BATCH).map((b) => ({
            buyerId: b.id,
            title,
            body: body || title,
            category: NotificationCategory.IMPORTANT,
          })),
        })
        .catch((e) => this.logger.warn(`Admin broadcast inbox write failed: ${String(e)}`));
    }

    const updated = await this.prisma.adminBroadcast.update({
      where: { id: broadcast.id },
      data: { deliveredCount: result.success, failedCount: result.failure },
    });
    this.logger.log(
      `Admin broadcast ${broadcast.id} (${audience}): ${recipientCount} user(s), ` +
        `${tokens.length} device(s), ${result.success} delivered, ${result.failure} failed`,
    );
    return updated;
  }
}
