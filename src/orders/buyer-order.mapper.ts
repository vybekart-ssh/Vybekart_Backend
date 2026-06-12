import { OrderStatus } from '@prisma/client';
import type { ReplacementTimelineStep } from '../replacements/replacement.mapper';

export type BuyerTimelineStepState = 'done' | 'active' | 'upcoming';

export interface BuyerTimelineStep {
  step: string;
  label: string;
  state: BuyerTimelineStepState;
  at?: string | null;
}

type BuyerOrderRow = {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  deliveryFee: number;
  shippingAddress: string | null;
  createdAt: Date;
  packedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  trackingId: string | null;
  carrierName: string | null;
  borzoTrackingUrl: string | null;
  deliveryStatus: string | null;
  items: Array<{
    id: string;
    quantity: number;
    price: number;
    variantId: string | null;
    variantLabel: string | null;
    product: {
      id: string;
      name: string;
      images: string[];
      seller?: { businessName: string; logoUrl: string | null } | null;
    };
  }>;
  replacementRequests?: Array<{ id: string; status: string }>;
};

export function buildBuyerOrderTimeline(
  order: Pick<
    BuyerOrderRow,
    'status' | 'createdAt' | 'packedAt' | 'shippedAt' | 'deliveredAt' | 'trackingId'
  >,
): BuyerTimelineStep[] {
  const status = order.status;
  const steps: Array<{
    step: string;
    label: string;
    done: boolean;
    at?: Date | null;
  }> = [
    {
      step: 'placed',
      label: 'Order placed',
      done: status !== OrderStatus.PENDING,
      at: order.createdAt,
    },
    {
      step: 'confirmed',
      label: 'Confirmed',
      done: (
        [
          OrderStatus.PAID,
          OrderStatus.PACKED,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ] as OrderStatus[]
      ).includes(status),
      at: order.createdAt,
    },
    {
      step: 'packed',
      label: 'Packed',
      done: (
        [OrderStatus.PACKED, OrderStatus.SHIPPED, OrderStatus.DELIVERED] as OrderStatus[]
      ).includes(status),
      at: order.packedAt,
    },
    {
      step: 'shipped',
      label: 'Shipped',
      done:
        ([OrderStatus.SHIPPED, OrderStatus.DELIVERED] as OrderStatus[]).includes(status) ||
        !!order.trackingId,
      at: order.shippedAt,
    },
    {
      step: 'delivered',
      label: 'Delivered',
      done: status === OrderStatus.DELIVERED,
      at: order.deliveredAt,
    },
  ];

  if (status === OrderStatus.CANCELLED) {
    return [
      {
        step: 'placed',
        label: 'Order placed',
        state: 'done',
        at: order.createdAt.toISOString(),
      },
      {
        step: 'cancelled',
        label: 'Cancelled',
        state: 'active',
        at: null,
      },
    ];
  }

  let activeIdx = steps.findIndex((s) => !s.done);
  if (activeIdx < 0) activeIdx = steps.length - 1;

  return steps.map((s, i) => ({
    step: s.step,
    label: s.label,
    state: (s.done ? 'done' : i === activeIdx ? 'active' : 'upcoming') as BuyerTimelineStepState,
    at: s.at?.toISOString() ?? null,
  }));
}

export function mapBuyerOrderListItem(order: BuyerOrderRow) {
  const first = order.items[0];
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
  const hasOpenReplacement =
    order.replacementRequests?.some((r) => r.status !== 'REJECTED' && r.status !== 'DELIVERED') ??
    false;

  return {
    id: order.id,
    status: order.status,
    totalAmount: order.totalAmount,
    deliveryFee: order.deliveryFee,
    createdAt: order.createdAt.toISOString(),
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    itemCount,
    primaryProductName: first?.product.name ?? 'Order',
    primaryProductImage: first?.product.images?.[0] ?? null,
    sellerName: first?.product.seller?.businessName ?? null,
    hasOpenReplacement,
    items: order.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      price: i.price,
      variantId: i.variantId,
      variantLabel: i.variantLabel,
      product: {
        id: i.product.id,
        name: i.product.name,
        images: i.product.images ?? [],
      },
    })),
  };
}

export function mapBuyerOrderDetail(order: BuyerOrderRow) {
  const openReplacement = order.replacementRequests?.find(
    (r) => r.status !== 'REJECTED' && r.status !== 'DELIVERED',
  );
  const canRequestReplacement =
    order.status === OrderStatus.DELIVERED &&
    !!order.deliveredAt &&
    !openReplacement;

  return {
    ...mapBuyerOrderListItem(order),
    shippingAddress: order.shippingAddress,
    trackingId: order.trackingId,
    carrierName: order.carrierName,
    trackingUrl: order.borzoTrackingUrl,
    deliveryStatus: order.deliveryStatus,
    timeline: buildBuyerOrderTimeline(order) as ReplacementTimelineStep[],
    canRequestReplacement,
    openReplacementId: openReplacement?.id ?? null,
  };
}
