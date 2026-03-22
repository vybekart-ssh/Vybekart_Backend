import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBuyerProfileDto } from './dto/update-buyer-profile.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService) {}

  async findOne(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true },
        },
        orders: { orderBy: { createdAt: 'desc' }, take: 20, include: { items: { include: { product: true } } } },
      },
    }); // Profile might be auto-created or checked here

    if (!buyer) throw new NotFoundException('Buyer profile not found');
    return buyer;
  }

  async updateProfile(userId: string, dto: UpdateBuyerProfileDto) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: userId } },
      });
      if (existing) throw new BadRequestException('Email already in use');
    }
    if (dto.phone) {
      const existing = await this.prisma.user.findFirst({
        where: { phone: dto.phone, NOT: { id: userId } },
      });
      if (existing) throw new BadRequestException('Phone already in use');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.email ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.phone ? { phone: dto.phone.trim() } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });
    return { success: true, user };
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

  async getReferrals(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const code = user.id.replace(/-/g, '').slice(0, 6).toUpperCase();
    return {
      code,
      inviteReward: 100,
      friendReward: 80,
      steps: [
        'Send an invite to a friend.',
        'Your friend signs up.',
        "You'll both get rewards",
      ],
      inviteText: `Use my VybeKart referral code ${code} and get ₹80 off on your first purchase.`,
    };
  }

  async applyReferral(userId: string, code: string) {
    if (!code || code.trim().length < 4) {
      throw new BadRequestException('Invalid referral code');
    }
    const normalized = code.trim().toUpperCase();
    const ownCode = userId.replace(/-/g, '').slice(0, 6).toUpperCase();
    if (normalized === ownCode) {
      throw new BadRequestException('You cannot apply your own referral code');
    }
    return {
      success: true,
      discount: 80,
      message: 'Referral code applied successfully',
    };
  }

  async getHelpSupport(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new NotFoundException('Buyer profile not found');

    const [recentOrders, faqs] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { buyerId: buyer.id },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.faq.findMany({
        orderBy: { sortOrder: 'asc' },
        take: 12,
      }),
    ]);

    const accountTopics = faqs.filter((f) =>
      /(password|account|login|profile)/i.test(f.question),
    );
    const orderTopics = faqs.filter((f) =>
      /(order|return|exchange|refund|delivery)/i.test(f.question),
    );

    return {
      recentOrders,
      topics: {
        account: accountTopics.length ? accountTopics : faqs.slice(0, 2),
        orders: orderTopics.length ? orderTopics : faqs.slice(2, 5),
      },
    };
  }

  async listAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({
      data: {
        userId,
        type: 'SHIPPING',
        line1: dto.line1.trim(),
        line2: dto.line2?.trim() || null,
        city: dto.city.trim(),
        state: dto.state.trim(),
        zip: dto.zip.trim(),
        country: (dto.country ?? 'IN').trim(),
        isDefault: dto.isDefault ?? false,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        contactName: dto.contactName?.trim() || null,
        phone: dto.phone?.trim() || null,
      },
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');

    if (dto.isDefault === true) {
      await this.prisma.address.updateMany({
        where: { userId, id: { not: addressId } },
        data: { isDefault: false },
      });
    }

    return this.prisma.address.update({
      where: { id: addressId },
      data: {
        ...(dto.line1 !== undefined ? { line1: dto.line1.trim() } : {}),
        ...(dto.line2 !== undefined ? { line2: dto.line2?.trim() || null } : {}),
        ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
        ...(dto.state !== undefined ? { state: dto.state.trim() } : {}),
        ...(dto.zip !== undefined ? { zip: dto.zip.trim() } : {}),
        ...(dto.country !== undefined ? { country: dto.country.trim() } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude ?? null } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude ?? null } : {}),
        ...(dto.contactName !== undefined
          ? { contactName: dto.contactName?.trim() || null }
          : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
      },
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const existing = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!existing) throw new NotFoundException('Address not found');
    await this.prisma.address.delete({ where: { id: addressId } });
    return { success: true };
  }
}
