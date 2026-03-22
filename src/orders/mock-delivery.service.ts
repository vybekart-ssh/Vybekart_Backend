import { Injectable } from '@nestjs/common';

/** D.6 — In-memory mock carrier for tests; replace with Shippo/EasyPost later. */
@Injectable()
export class MockDeliveryService {
  private readonly shipments = new Map<
    string,
    { createdAt: number; lastPoll: number; phase: number }
  >();

  requestPickup(orderId: string): {
    trackingId: string;
    carrierName: string;
    externalId: string;
  } {
    const trackingId = `MOCK-${orderId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    this.shipments.set(orderId, {
      createdAt: Date.now(),
      lastPoll: Date.now(),
      phase: 0,
    });
    return {
      trackingId,
      carrierName: 'VybeKart Mock Logistics',
      externalId: `mock-shp-${orderId}`,
    };
  }

  /** D.7 — Advance mock state on poll (no real webhook in dev). */
  getDeliveryStatus(orderId: string): string {
    const s = this.shipments.get(orderId);
    if (!s) return 'UNKNOWN';
    const elapsed = Date.now() - s.createdAt;
    if (elapsed < 15_000) return 'REQUESTED';
    if (elapsed < 45_000) return 'PICKED_UP';
    if (elapsed < 120_000) return 'IN_TRANSIT';
    return 'OUT_FOR_DELIVERY';
  }

  touchPoll(orderId: string): void {
    const s = this.shipments.get(orderId);
    if (s) {
      s.lastPoll = Date.now();
      s.phase = Math.min(s.phase + 1, 4);
    }
  }
}
