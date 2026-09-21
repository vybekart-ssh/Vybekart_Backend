import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingPayer } from '@prisma/client';

const GLOBAL_CONFIG_ID = 'global';

export type ProductGstSlabRules = {
  productGstPriceThresholdInr: number;
  productGstPercentBelow: number;
  productGstPercentAtOrAbove: number;
};

@Injectable()
export class AppConfigService {
  constructor(private prisma: PrismaService) {}

  async getPublicAndroid() {
    const row = await this.ensureRow();
    return {
      minAndroidVersionCode: row.minAndroidVersionCode,
      latestAndroidVersionName: row.latestAndroidVersionName,
      productGstPriceThresholdInr: row.productGstPriceThresholdInr,
      productGstPercentBelow: row.productGstPercentBelow,
      productGstPercentAtOrAbove: row.productGstPercentAtOrAbove,
      shippingPayer: row.shippingPayer,
    };
  }

  async getMinAndroidVersionCode(): Promise<number> {
    const row = await this.ensureRow();
    return row.minAndroidVersionCode;
  }

  async getShippingPayer(): Promise<ShippingPayer> {
    const row = await this.ensureRow();
    return row.shippingPayer;
  }

  async getProductGstSlabRules(): Promise<ProductGstSlabRules> {
    const row = await this.ensureRow();
    return {
      productGstPriceThresholdInr: row.productGstPriceThresholdInr,
      productGstPercentBelow: row.productGstPercentBelow,
      productGstPercentAtOrAbove: row.productGstPercentAtOrAbove,
    };
  }

  /** Resolve GST % from inclusive selling price. Threshold = max INR for the lower slab (inclusive). */
  resolveGstPercentForPrice(
    sellingPriceInr: number,
    rules: ProductGstSlabRules,
  ): number {
    if (!Number.isFinite(sellingPriceInr)) {
      return rules.productGstPercentBelow;
    }
    if (sellingPriceInr <= rules.productGstPriceThresholdInr) {
      return rules.productGstPercentBelow;
    }
    return rules.productGstPercentAtOrAbove;
  }

  async updateAndroidConfig(data: {
    minAndroidVersionCode?: number;
    latestAndroidVersionName?: string | null;
    productGstPriceThresholdInr?: number;
    productGstPercentBelow?: number;
    productGstPercentAtOrAbove?: number;
    shippingPayer?: ShippingPayer;
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
        ...(data.productGstPriceThresholdInr !== undefined && {
          productGstPriceThresholdInr: data.productGstPriceThresholdInr,
        }),
        ...(data.productGstPercentBelow !== undefined && {
          productGstPercentBelow: data.productGstPercentBelow,
        }),
        ...(data.productGstPercentAtOrAbove !== undefined && {
          productGstPercentAtOrAbove: data.productGstPercentAtOrAbove,
        }),
        ...(data.shippingPayer !== undefined && {
          shippingPayer: data.shippingPayer,
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
        productGstPriceThresholdInr: 1000,
        productGstPercentBelow: 5,
        productGstPercentAtOrAbove: 12,
        shippingPayer: ShippingPayer.SELLER_PAYS,
      },
      update: {},
    });
  }
}
