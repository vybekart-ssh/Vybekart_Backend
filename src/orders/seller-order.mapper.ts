import { OrderStatus } from '@prisma/client';

export type TimelineStepState = 'done' | 'active' | 'upcoming';

export type SellerNextActionType =
  | 'PACK_VIDEO'
  | 'REQUEST_DELIVERY'
  | 'TRACK'
  | 'NONE';

export interface SellerTimelineStep {
  step: string;
  label: string;
  state: TimelineStepState;
  at?: string | null;
}

export interface SellerNextAction {
  type: SellerNextActionType;
  label: string;
}

type OrderWithRelations = {
  id: string;
  status: OrderStatus;
  totalAmount: number;
  deliveryFee: number;
  shippingAddress: string | null;
  streamId: string | null;
  packingVideoUrl: string | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  trackingId: string | null;
  carrierName: string | null;
  borzoTrackingUrl: string | null;
  deliveryStatus: string | null;
  createdAt: Date;
  items: Array<{
    quantity: number;
    price: number;
    variantId: string | null;
    variantLabel: string | null;
    product: {
      id: string;
      name: string;
      images: string[];
      sellerId: string;
    };
  }>;
  buyer: {
    user: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  } | null;
};

export function buildSellerOrderTimeline(
  order: Pick<
    OrderWithRelations,
    | 'status'
    | 'createdAt'
    | 'packedAt'
    | 'shippedAt'
    | 'deliveredAt'
    | 'packingVideoUrl'
    | 'trackingId'
  >,
): SellerTimelineStep[] {
  const status = order.status;
  const steps: Array<{
    step: string;
    label: string;
    done: boolean;
    at?: Date | null;
  }> = [
    {
      step: 'received',
      label: 'Order received',
      done: status !== OrderStatus.PENDING && status !== OrderStatus.CANCELLED,
      at: order.createdAt,
    },
    {
      step: 'pack_video',
      label: 'Record packing video',
      done:
        !!order.packingVideoUrl ||
        status === OrderStatus.PACKED ||
        status === OrderStatus.SHIPPED ||
        status === OrderStatus.DELIVERED,
      at: order.packedAt,
    },
    {
      step: 'packed',
      label: 'Packed',
      done:
        status === OrderStatus.PACKED ||
        status === OrderStatus.SHIPPED ||
        status === OrderStatus.DELIVERED,
      at: order.packedAt,
    },
    {
      step: 'delhivery',
      label: 'Delhivery pickup',
      done:
        !!order.trackingId ||
        status === OrderStatus.SHIPPED ||
        status === OrderStatus.DELIVERED,
      at: order.shippedAt,
    },
    {
      step: 'in_transit',
      label: 'In transit',
      done: status === OrderStatus.SHIPPED || status === OrderStatus.DELIVERED,
      at: order.shippedAt,
    },
    {
      step: 'delivered',
      label: 'Delivered',
      done: status === OrderStatus.DELIVERED,
      at: order.deliveredAt,
    },
  ];

  let foundActive = false;
  return steps.map((s) => {
    let state: TimelineStepState;
    if (s.done) {
      state = 'done';
    } else if (!foundActive) {
      state = 'active';
      foundActive = true;
    } else {
      state = 'upcoming';
    }
    return {
      step: s.step,
      label: s.label,
      state,
      at: s.at ? s.at.toISOString() : null,
    };
  });
}

export function buildSellerNextAction(order: {
  status: OrderStatus;
  streamId: string | null;
}): SellerNextAction {
  switch (order.status) {
    case OrderStatus.PAID:
      return {
        type: 'PACK_VIDEO',
        label: 'Record packing video',
      };
    case OrderStatus.PACKED:
      return {
        type: 'REQUEST_DELIVERY',
        label: 'Request Delhivery pickup',
      };
    case OrderStatus.SHIPPED:
      return {
        type: 'TRACK',
        label: 'Refresh delivery status',
      };
    default:
      return { type: 'NONE', label: 'No action needed' };
  }
}

export function mapSellerOrder(order: OrderWithRelations) {
  return {
    id: order.id,
    status: order.status,
    totalAmount: order.totalAmount,
    deliveryFee: order.deliveryFee,
    shippingAddress: order.shippingAddress,
    streamId: order.streamId,
    packingVideoUrl: order.packingVideoUrl,
    packedAt: order.packedAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    trackingId: order.trackingId,
    carrierName: order.carrierName,
    trackingUrl: order.borzoTrackingUrl,
    deliveryStatus: order.deliveryStatus,
    createdAt: order.createdAt.toISOString(),
    buyer: order.buyer
      ? {
          user: order.buyer.user
            ? {
                name: order.buyer.user.name,
                email: order.buyer.user.email,
                phone: order.buyer.user.phone,
              }
            : null,
        }
      : null,
    items: order.items.map((item) => ({
      quantity: item.quantity,
      price: item.price,
      variantId: item.variantId,
      variantLabel: item.variantLabel,
      product: {
        id: item.product.id,
        name: item.product.name,
        images: item.product.images ?? [],
      },
    })),
    timeline: buildSellerOrderTimeline(order),
    nextAction: buildSellerNextAction(order),
  };
}

/** IST calendar day bounds for seller date filters */
export function resolveSellerDateRange(
  dateParam?: string,
): { gte: Date; lt: Date } | null {
  if (!dateParam?.trim()) return null;

  const tz = 'Asia/Kolkata';
  let ymd: string;
  if (dateParam === 'today') {
    ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    ymd = dateParam;
  } else {
    return null;
  }

  const [y, m, d] = ymd.split('-').map(Number);
  const gte = new Date(Date.UTC(y, m - 1, d, -5, -30, 0));
  const lt = new Date(Date.UTC(y, m - 1, d + 1, -5, -30, 0));
  return { gte, lt };
}

export function isDelhiveryDeliveredStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s === 'delivered' ||
    s === 'dto' ||
    s.includes('delivered')
  );
}
