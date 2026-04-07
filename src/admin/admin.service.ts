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
