<<<<<<< HEAD
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listSellers(status?: string) {
    const where =
      status && Object.values(VerificationStatus).includes(status as any)
        ? { status: status as any }
        : {};
    const sellers = await this.prisma.seller.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    });
    return sellers.map((s) => ({
      id: s.id,
      status: s.status,
      rejectionReason: s.rejectionReason,
      user: s.user,
    }));
  }

  async sellerDetail(id: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: { user: true, primaryCategory: true, categories: true },
    });
    if (!seller) throw new NotFoundException('Seller not found');
    return seller;
  }

  async approveSeller(id: string) {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) throw new NotFoundException('Seller not found');
    return this.prisma.seller.update({
      where: { id },
      data: { status: VerificationStatus.VERIFIED, rejectionReason: null },
    });
  }

  async rejectSeller(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Reason is required');
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) throw new NotFoundException('Seller not found');
    return this.prisma.seller.update({
      where: { id },
      data: { status: VerificationStatus.REJECTED, rejectionReason: reason.trim() },
    });
  }

  async reregisterSeller(id: string) {
    const seller = await this.prisma.seller.findUnique({ where: { id } });
    if (!seller) throw new NotFoundException('Seller not found');
    return this.prisma.seller.update({
      where: { id },
      data: { status: VerificationStatus.PENDING, rejectionReason: null },
    });
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
        packedAt: o.packedAt,
        packingVideoUrl: o.packingVideoUrl,
        streamId: o.streamId,
        seller: seller
          ? { id: seller.id, businessName: seller.businessName, userId: seller.userId }
          : null,
      };
    });
  }
}

=======
import { Injectable, NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SellersService } from '../sellers/sellers.service';
import { AppConfigService } from '../app-config/app-config.service';
import { UpdateAppConfigDto } from './dto/update-app-config.dto';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private sellersService: SellersService,
    private appConfig: AppConfigService,
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

  reregisterSeller(sellerId: string) {
    return this.sellersService.reregisterSeller(sellerId);
  }

  getAppConfig() {
    return this.appConfig.getPublicAndroid();
  }

  async patchAppConfig(dto: UpdateAppConfigDto) {
    if (
      dto.minAndroidVersionCode === undefined &&
      dto.latestAndroidVersionName === undefined
    ) {
      return this.appConfig.getPublicAndroid();
    }
    await this.appConfig.updateAndroidConfig({
      minAndroidVersionCode: dto.minAndroidVersionCode,
      latestAndroidVersionName: dto.latestAndroidVersionName,
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
}
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
