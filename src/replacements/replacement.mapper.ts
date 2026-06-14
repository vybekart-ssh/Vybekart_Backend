import { BalancePaymentStatus, ReplacementStatus } from '@prisma/client';

export type ReplacementTimelineStepState = 'done' | 'active' | 'upcoming';

export interface ReplacementTimelineStep {
  step: string;
  label: string;
  state: ReplacementTimelineStepState;
  at?: string | null;
}

export type ReplacementNextActionType =
  | 'PAY_BALANCE'
  | 'PACK_VIDEO'
  | 'REQUEST_DELIVERY'
  | 'TRACK'
  | 'NONE';

export interface ReplacementNextAction {
  type: ReplacementNextActionType;
  label: string;
}

type ReplacementRow = {
  id: string;
  status: ReplacementStatus;
  reason: string;
  description: string | null;
  photoUrls: string[];
  adminNote: string | null;
  autoApproved: boolean;
  decidedAt: Date | null;
  createdAt: Date;
  orderItemId: string | null;
  replacementVariantId: string | null;
  replacementVariantLabel: string | null;
  originalUnitPrice: number;
  replacementUnitPrice: number;
  balanceDue: number;
  balancePaymentStatus: BalancePaymentStatus;
  packingVideoUrl: string | null;
  packedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  trackingId: string | null;
  carrierName: string | null;
  deliveryProvider: string | null;
  deliveryStatus: string | null;
  borzoTrackingUrl: string | null;
  order?: {
    id: string;
    totalAmount: number;
    deliveryFee?: number;
    shippingAddress?: string | null;
    deliveredAt?: Date | null;
    items?: Array<{
      id: string;
      quantity: number;
      price: number;
      variantId: string | null;
      variantLabel: string | null;
      product: {
        id: string;
        name: string;
        images: string[];
        returnable?: boolean | null;
      };
    }>;
  };
  seller?: { businessName: string; logoUrl: string | null };
  buyer?: { user?: { name: string | null; email: string | null } | null };
};

export function buildReplacementTimeline(
  r: Pick<
    ReplacementRow,
    | 'status'
    | 'createdAt'
    | 'decidedAt'
    | 'packedAt'
    | 'shippedAt'
    | 'deliveredAt'
    | 'packingVideoUrl'
    | 'trackingId'
    | 'balanceDue'
    | 'balancePaymentStatus'
  >,
): ReplacementTimelineStep[] {
  const status = r.status;
  const paidBalance =
    r.balanceDue <= 0 ||
    r.balancePaymentStatus === BalancePaymentStatus.PAID ||
    status !== ReplacementStatus.AWAITING_PAYMENT;

  const steps: Array<{
    step: string;
    label: string;
    done: boolean;
    at?: Date | null;
  }> = [
    {
      step: 'submitted',
      label: 'Request submitted',
      done: true,
      at: r.createdAt,
    },
    {
      step: 'review',
      label: 'Under review',
      done:
        status !== ReplacementStatus.REQUESTED &&
        status !== ReplacementStatus.PENDING_ADMIN_REVIEW,
      at: r.decidedAt,
    },
    ...(r.balanceDue > 0
      ? [
          {
            step: 'payment',
            label: 'Balance payment',
            done: paidBalance,
            at: paidBalance ? r.decidedAt : null,
          },
        ]
      : []),
    {
      step: 'approved',
      label: 'Approved',
      done: (
        [
          ReplacementStatus.APPROVED,
          ReplacementStatus.PACKED,
          ReplacementStatus.SHIPPED,
          ReplacementStatus.DELIVERED,
        ] as ReplacementStatus[]
      ).includes(status),
      at: r.decidedAt,
    },
    {
      step: 'packed',
      label: 'Packed',
      done: !!r.packingVideoUrl || !!r.packedAt || status === ReplacementStatus.PACKED || status === ReplacementStatus.SHIPPED || status === ReplacementStatus.DELIVERED,
      at: r.packedAt,
    },
    {
      step: 'shipped',
      label: 'Shipped',
      done: status === ReplacementStatus.SHIPPED || status === ReplacementStatus.DELIVERED || !!r.trackingId,
      at: r.shippedAt,
    },
    {
      step: 'delivered',
      label: 'Delivered',
      done: status === ReplacementStatus.DELIVERED,
      at: r.deliveredAt,
    },
  ];

  if (status === ReplacementStatus.REJECTED) {
    return steps
      .filter((s) => s.step === 'submitted' || s.step === 'review')
      .map((s, i, arr) => ({
        step: s.step,
        label: s.label,
        state: (i < arr.length - 1 ? 'done' : 'active') as ReplacementTimelineStepState,
        at: s.at?.toISOString() ?? null,
      }))
      .concat({
        step: 'rejected',
        label: 'Rejected',
        state: 'active',
        at: r.decidedAt?.toISOString() ?? null,
      });
  }

  let activeIdx = steps.findIndex((s) => !s.done);
  if (activeIdx < 0) activeIdx = steps.length - 1;

  return steps.map((s, i) => ({
    step: s.step,
    label: s.label,
    state: (s.done ? 'done' : i === activeIdx ? 'active' : 'upcoming') as ReplacementTimelineStepState,
    at: s.at?.toISOString() ?? null,
  }));
}

export function buildBuyerReplacementNextAction(
  r: Pick<ReplacementRow, 'status' | 'balanceDue' | 'balancePaymentStatus'>,
): ReplacementNextAction | null {
  if (
    r.status === ReplacementStatus.AWAITING_PAYMENT &&
    r.balanceDue > 0 &&
    r.balancePaymentStatus !== BalancePaymentStatus.PAID
  ) {
    return { type: 'PAY_BALANCE', label: `Pay balance ₹${r.balanceDue.toFixed(0)}` };
  }
  return null;
}

export function buildSellerReplacementNextAction(
  r: Pick<
    ReplacementRow,
    | 'status'
    | 'balanceDue'
    | 'balancePaymentStatus'
    | 'packingVideoUrl'
    | 'trackingId'
    | 'deliveryProvider'
  >,
): ReplacementNextAction {
  if (
    r.status === ReplacementStatus.AWAITING_PAYMENT &&
    r.balancePaymentStatus !== BalancePaymentStatus.PAID
  ) {
    return { type: 'NONE', label: 'Waiting for buyer payment' };
  }
  if (r.status === ReplacementStatus.APPROVED && !r.packingVideoUrl) {
    return { type: 'PACK_VIDEO', label: 'Record pack video' };
  }
  if (r.status === ReplacementStatus.PACKED && !r.trackingId) {
    return { type: 'REQUEST_DELIVERY', label: 'Request Delhivery pickup' };
  }
  if (
    (r.status === ReplacementStatus.SHIPPED || r.status === ReplacementStatus.PACKED) &&
    r.trackingId &&
    r.deliveryProvider === 'DELHIVERY'
  ) {
    return { type: 'TRACK', label: 'Track shipment' };
  }
  return { type: 'NONE', label: 'No action needed' };
}

export function mapReplacementDetail(r: ReplacementRow, role: 'buyer' | 'seller' | 'admin') {
  const orderItem =
    r.order?.items?.find((i) => i.id === r.orderItemId) ?? r.order?.items?.[0];
  const timeline = buildReplacementTimeline(r);
  const nextAction =
    role === 'buyer'
      ? buildBuyerReplacementNextAction(r)
      : role === 'seller'
        ? buildSellerReplacementNextAction(r)
        : null;

  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    description: r.description,
    photoUrls: r.photoUrls ?? [],
    adminNote: r.adminNote,
    autoApproved: r.autoApproved,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    orderId: r.order?.id ?? null,
    order: r.order
      ? { id: r.order.id, totalAmount: r.order.totalAmount }
      : null,
    orderItemId: r.orderItemId,
    original: orderItem
      ? {
          productId: orderItem.product.id,
          productName: orderItem.product.name,
          productImage: orderItem.product.images?.[0] ?? null,
          variantId: orderItem.variantId,
          variantLabel: orderItem.variantLabel,
          unitPrice: r.originalUnitPrice || orderItem.price,
          quantity: orderItem.quantity,
        }
      : null,
    replacement: {
      variantId: r.replacementVariantId,
      variantLabel: r.replacementVariantLabel,
      unitPrice: r.replacementUnitPrice,
    },
    pricing: {
      originalUnitPrice: r.originalUnitPrice,
      replacementUnitPrice: r.replacementUnitPrice,
      balanceDue: r.balanceDue,
      balancePaymentStatus: r.balancePaymentStatus,
    },
    fulfillment: {
      packingVideoUrl: r.packingVideoUrl,
      packedAt: r.packedAt?.toISOString() ?? null,
      shippedAt: r.shippedAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      trackingId: r.trackingId,
      carrierName: r.carrierName,
      deliveryProvider: r.deliveryProvider,
      deliveryStatus: r.deliveryStatus,
      trackingUrl: r.borzoTrackingUrl,
    },
    seller: r.seller
      ? { businessName: r.seller.businessName, logoUrl: r.seller.logoUrl }
      : null,
    timeline,
    nextAction,
  };
}
