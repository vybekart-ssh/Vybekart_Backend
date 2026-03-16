import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService) {}

  async findOne(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: {
        orders: true,
      },
    }); // Profile might be auto-created or checked here

    if (!buyer) throw new NotFoundException('Buyer profile not found');
    return buyer;
  }

  async getFeed(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    const [upcomingLive, recentlyViewed, recommendedProducts] =
      await this.prisma.$transaction([
        this.prisma.stream.findMany({
          where: { startedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { seller: { select: { businessName: true, id: true } } },
        }),
        this.prisma.recentlyViewedProduct.findMany({
          where: { buyerId: buyer.id },
          orderBy: { viewedAt: 'desc' },
          take: 10,
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                images: true,
                seller: { select: { businessName: true } },
              },
            },
          },
        }),
        this.prisma.product.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            name: true,
            price: true,
            images: true,
            seller: { select: { businessName: true } },
          },
        }),
      ]);

    return {
      upcomingLive,
      recentlyViewed: recentlyViewed.map((rv) => ({
        id: rv.id,
        viewedAt: rv.viewedAt,
        product: rv.product,
      })),
      recommendedProducts,
    };
  }

  async getNotifications(userId: string, category?: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    return this.prisma.notification.findMany({
      where: {
        buyerId: buyer.id,
        ...(category
          ? { category: category.toUpperCase() as any }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    const notif = await this.prisma.notification.findFirst({
      where: { id: notificationId, buyerId: buyer.id },
    });
    if (!notif) throw new NotFoundException('Notification not found');

    return this.prisma.notification.update({
      where: { id: notif.id },
      data: { isRead: true },
    });
  }

  async markAllNotificationsRead(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    await this.prisma.notification.updateMany({
      where: { buyerId: buyer.id, isRead: false },
      data: { isRead: true },
    });

    return { success: true };
  }
}
