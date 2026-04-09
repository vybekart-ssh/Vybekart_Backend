import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const GLOBAL_CONFIG_ID = 'global';

@Injectable()
export class AppConfigService {
  constructor(private prisma: PrismaService) {}

  async getPublicAndroid() {
    const row = await this.ensureRow();
    return {
      minAndroidVersionCode: row.minAndroidVersionCode,
      latestAndroidVersionName: row.latestAndroidVersionName,
    };
  }

  async getMinAndroidVersionCode(): Promise<number> {
    const row = await this.ensureRow();
    return row.minAndroidVersionCode;
  }

  async updateAndroidConfig(data: {
    minAndroidVersionCode?: number;
    latestAndroidVersionName?: string | null;
  }) {
    await this.ensureRow();
    return this.prisma.appConfig.update({
      where: { id: GLOBAL_CONFIG_ID },
      data: {
        ...(data.minAndroidVersionCode !== undefined && {
          minAndroidVersionCode: data.minAndroidVersionCode,
        }),
        ...(data.latestAndroidVersionName !== undefined && {
          latestAndroidVersionName: data.latestAndroidVersionName,
        }),
      },
    });
  }

  private async ensureRow() {
    return this.prisma.appConfig.upsert({
      where: { id: GLOBAL_CONFIG_ID },
      create: {
        id: GLOBAL_CONFIG_ID,
        minAndroidVersionCode: 1,
        latestAndroidVersionName: '1.0',
      },
      update: {},
    });
  }
}
