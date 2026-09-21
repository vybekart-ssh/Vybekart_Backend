import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AddressType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DelhiveryService } from './delhivery.service';

/**
 * Stable Delhivery warehouse name for a seller.
 * No underscores — Delhivery rejects `_` in registered_name.
 */
export function buildSellerWarehouseName(sellerId: string): string {
  const compact = sellerId.replace(/-/g, '').slice(0, 16);
  return `VK${compact}`;
}

function formatPickupStreet(a: {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  return [a.line1, a.line2, a.city, a.state, a.zip]
    .map((s) => (s ?? '').toString().trim())
    .filter(Boolean)
    .join(', ');
}

function digitsPhone(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return d;
}

@Injectable()
export class DelhiveryWarehouseService {
  private readonly logger = new Logger(DelhiveryWarehouseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delhivery: DelhiveryService,
  ) {}

  /**
   * Ensure the seller's pickup address is registered as a Delhivery warehouse.
   * Returns the warehouse name to use as pickup_location.name.
   */
  async ensureForSeller(
    sellerId: string,
    opts?: { throwOnFailure?: boolean },
  ): Promise<string | null> {
    const throwOnFailure = opts?.throwOnFailure ?? false;

    if (!this.delhivery.isConfigured()) {
      const msg = 'Delhivery is not configured on the server';
      await this.recordError(sellerId, msg);
      if (throwOnFailure) throw new ServiceUnavailableException(msg);
      return null;
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: {
        user: { select: { phone: true, email: true, name: true } },
      },
    });
    if (!seller) {
      if (throwOnFailure) throw new BadRequestException('Seller not found');
      return null;
    }

    const pickup = await this.prisma.address.findFirst({
      where: { userId: seller.userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup?.zip?.trim() || pickup.zip.trim().length !== 6) {
      const msg =
        'Pickup address with a valid 6-digit pincode is required before Delhivery sync';
      await this.recordError(sellerId, msg);
      if (throwOnFailure) throw new BadRequestException(msg);
      return null;
    }

    const phone = digitsPhone(seller.user.phone ?? pickup.phone);
    if (phone.length < 10) {
      const msg =
        'Seller phone (10 digits) is required to register the Delhivery pickup warehouse';
      await this.recordError(sellerId, msg);
      if (throwOnFailure) throw new BadRequestException(msg);
      return null;
    }

    const email = seller.user.email?.trim();
    if (!email) {
      const msg = 'Seller email is required to register the Delhivery pickup warehouse';
      await this.recordError(sellerId, msg);
      if (throwOnFailure) throw new BadRequestException(msg);
      return null;
    }

    const warehouseName =
      seller.delhiveryWarehouseName?.trim() ||
      buildSellerWarehouseName(seller.id);
    const addressLine = formatPickupStreet(pickup);
    const city = pickup.city.trim();
    const pin = pickup.zip.trim();
    const state = pickup.state.trim() || city;

    // Prefer edit when we already have a name; fall back to create.
    if (seller.delhiveryWarehouseName?.trim()) {
      const edited = await this.delhivery.editClientWarehouse({
        name: warehouseName,
        pin,
        phone,
        address: addressLine,
        registeredName: warehouseName,
      });
      if (edited.success) {
        await this.recordSuccess(sellerId, warehouseName);
        return warehouseName;
      }
      const missing =
        (edited.error ?? '').toLowerCase().includes("doesn't exist") ||
        (edited.error ?? '').toLowerCase().includes('does not exist');
      if (!missing) {
        await this.recordError(sellerId, edited.error ?? 'Warehouse update failed');
        if (throwOnFailure) {
          throw new BadRequestException(
            `Could not update Delhivery pickup warehouse. ${edited.error ?? ''}`.trim(),
          );
        }
        return null;
      }
      // Fall through to create
    }

    const created = await this.delhivery.createClientWarehouse({
      name: warehouseName,
      registeredName: warehouseName,
      phone,
      email,
      address: addressLine,
      city,
      pin,
      country: 'India',
      returnAddress: addressLine,
      returnPin: pin,
      returnCity: city,
      returnState: state,
      returnCountry: 'India',
    });

    if (created.success) {
      await this.recordSuccess(sellerId, warehouseName);
      return warehouseName;
    }

    // Already exists → treat as success and persist the name.
    const errLower = (created.error ?? '').toLowerCase();
    const already =
      errLower.includes('already exist') ||
      errLower.includes('already created') ||
      errLower.includes('duplicate');
    if (already) {
      this.logger.warn(
        `Delhivery warehouse create reported existing name=${warehouseName}; storing on seller`,
      );
      await this.recordSuccess(sellerId, warehouseName);
      await this.delhivery.editClientWarehouse({
        name: warehouseName,
        pin,
        phone,
        address: addressLine,
        registeredName: warehouseName,
      });
      return warehouseName;
    }

    await this.recordError(sellerId, created.error ?? 'Warehouse create failed');
    if (throwOnFailure) {
      throw new BadRequestException(
        `Could not register Delhivery pickup warehouse. ${created.error ?? ''}`.trim(),
      );
    }
    return null;
  }

  private async recordSuccess(sellerId: string, name: string) {
    await this.prisma.seller.update({
      where: { id: sellerId },
      data: {
        delhiveryWarehouseName: name,
        delhiveryWarehouseSyncedAt: new Date(),
        delhiveryWarehouseLastError: null,
      },
    });
  }

  private async recordError(sellerId: string, error: string) {
    try {
      await this.prisma.seller.update({
        where: { id: sellerId },
        data: { delhiveryWarehouseLastError: error.slice(0, 500) },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to record Delhivery warehouse error for seller=${sellerId}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
