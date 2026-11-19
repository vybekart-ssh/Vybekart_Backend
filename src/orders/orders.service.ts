import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { Address, AddressType, OrderStatus, Prisma, ShippingPayer } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { CartItemDto, MAX_CART_LINE_QUANTITY } from './dto/cart-item.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_SUPPORT_PHONE } from '../support/support.constants';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';
import { BuyerOrdersQueryDto } from './dto/buyer-orders-query.dto';
import { MockDeliveryService } from './mock-delivery.service';
import { DelhiveryService } from '../delhivery/delhivery.service';
import { PackingVideoStorageService } from '../storage/packing-video-storage.service';
import { FirebasePushService } from '../notifications/firebase-push.service';
import * as path from 'path';
import {
  applyVariantStockDelta,
  findVariantItem,
  productHasVariantItems,
} from '../products/product-variants.util';
import { RatingsService } from '../ratings/ratings.service';
import { OrderNotificationService } from '../mail/order-notification.service';
import {
  isDelhiveryDeliveredStatus,
  mapSellerOrder,
  resolveSellerDateRange,
  resolveSellerDateSpan,
} from './seller-order.mapper';
import {
  mapBuyerOrderDetail,
  mapBuyerOrderListItem,
} from './buyer-order.mapper';
import { AppConfigService } from '../app-config/app-config.service';
import { DelhiveryWarehouseService } from '../delhivery/delhivery-warehouse.service';
import { CouponsService } from '../coupons/coupons.service';
import {
  ARCHIVE_RETENTION_FOREVER,
  computeArchiveExpiresAt,
  normalizeArchiveRetentionHours,
} from '../streams/archive-retention.util';

/** Minimum post-live cart window; longer archive retention extends it. */
const POST_LIVE_CART_HOURS = 24;
/** Carts never expire (B7); long Redis TTL is only a safety net (90 days). */
const CART_REDIS_TTL_SECONDS = 90 * 24 * 60 * 60;

type StreamArchiveWindow = {
  archiveRetentionHours?: number | null;
  archiveExpiresAt?: Date | null;
};

/**
 * B8 multi-seller cart: each line carries its own `streamId`/`streamTitle`.
 * Top-level `streamId` is only the "primary" (most recently added) stream kept
 * for backward-compatible clients and Redis stream indexing.
 */
type SellerCheckoutGroup = {
  sellerId: string;
  streamId: string;
  items: Array<{
    productId: string;
    quantity: number;
    variantId?: string;
    variantLabel?: string;
  }>;
  subtotal: number;
};

type CartState = {
  items: CartItemDto[];
  streamId?: string;
  streamTitle?: string;
  cartExpiresAt?: string;
  cartUpdatedAt?: string;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
    private mockDelivery: MockDeliveryService,
    private delhivery: DelhiveryService,
    private ratings: RatingsService,
    private orderNotifications: OrderNotificationService,
    private appConfig: AppConfigService,
    private delhiveryWarehouses: DelhiveryWarehouseService,
    @Inject(forwardRef(() => CouponsService))
    private coupons: CouponsService,
    private packingVideos: PackingVideoStorageService,
    private firebasePush: FirebasePushService,
  ) {}

  /** Fee charged to the buyer given who pays shipping. */
  private buyerDeliveryFeeFor(
    shippingPayer: ShippingPayer,
    actualFee: number,
  ): number {
    return shippingPayer === ShippingPayer.BUYER_PAYS ? actualFee : 0;
  }

  private async assertStreamAndProducts(streamId: string, productIds: string[]) {
    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { streamProducts: true },
    });
    if (!stream) {
      throw new BadRequestException('Invalid stream');
    }
    if (!stream.startedAt) {
      throw new BadRequestException('This stream has not started yet');
    }
    // Cart items never expire by time — ended/post-live streams stay purchaseable.
    // Still reject inconsistent "ended but still marked live" rows.
    if (stream.endedAt && stream.isLive) {
      throw new BadRequestException(
        'This stream is no longer available for checkout.',
      );
    }
    if (!stream.isLive && !stream.endedAt) {
      throw new BadRequestException(
        'This stream has ended; you cannot purchase from a replay.',
      );
    }
    const allowed = new Set(stream.streamProducts.map((sp) => sp.productId));
    const uniqueIds = [...new Set(productIds)];
    for (const pid of uniqueIds) {
      if (!allowed.has(pid)) {
        throw new BadRequestException(
          `Product is not part of this live stream listing`,
        );
      }
    }
  }

  /**
   * Validates cart lines can become an order (products, variants, stock, stream).
   * Must run before Razorpay opens and again at checkout.
   */
  async validateCartForCheckout(userId: string): Promise<void> {
    const rawState = await this.loadCartForUser(userId);
    if (!rawState.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    if (rawState.items.some((i) => !i.streamId)) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }

    const cart = await this.getCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    if (cart.items.length !== rawState.items.length) {
      throw new BadRequestException(
        'One or more products in your cart are no longer available. Please update your cart.',
      );
    }

    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }

    // Multi-seller cart: validate each stream's lines against that stream.
    const byStream = new Map<string, CartItemDto[]>();
    for (const i of cart.items) {
      const sid = i.streamId as string;
      byStream.set(sid, [...(byStream.get(sid) ?? []), i]);
    }
    for (const [sid, lines] of byStream) {
      await this.validateOrderItems(
        sid,
        lines.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          variantId: i.variantId,
          variantLabel: i.variantLabel,
        })),
      );
    }
  }

  private async validateOrderItems(
    streamId: string,
    items: Array<{
      productId: string;
      quantity: number;
      variantId?: string;
      variantLabel?: string;
    }>,
  ): Promise<void> {
    if (!items.length) {
      throw new BadRequestException('Order must have at least one item');
    }

    const uniqueProductIds = [...new Set(items.map((i) => i.productId))];
    await this.assertStreamAndProducts(streamId, uniqueProductIds);

    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueProductIds } },
      include: { seller: true },
    });
    if (products.length !== uniqueProductIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = uniqueProductIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        missing.length
          ? `One or more products not found: ${missing.join(', ')}`
          : 'One or more products not found',
      );
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found`);
      }
      const hasVariants = productHasVariantItems(product.variants);
      if (hasVariants) {
        if (!item.variantId?.trim()) {
          throw new BadRequestException(
            `variantId is required for product ${product.name}`,
          );
        }
        const v = findVariantItem(product.variants, item.variantId);
        if (!v) {
          throw new BadRequestException(
            `Invalid variant for product ${product.name}`,
          );
        }
        if (v.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for ${product.name} (${v.label}). Available: ${v.stock}`,
          );
        }
      } else if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${product.name}. Available: ${product.stock}`,
        );
      }
    }
  }

  private cartKey(userId: string): string {
    return `orders:cart:${userId}`;
  }

  private async loadCartState(userId: string): Promise<CartState> {
    const raw = await this.redis.get(this.cartKey(userId));
    if (!raw) return { items: [] };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.logger.warn(
          `Legacy cart array format for userId=${userId} — will expire on next enforce`,
        );
        return {
          items: parsed as CartItemDto[],
          cartUpdatedAt: new Date(0).toISOString(),
        };
      }
      const o = parsed as CartState;
      return {
        // Legacy single-stream carts: lines inherit the cart-level stream.
        items: (o.items ?? []).map((i) => ({
          ...i,
          streamId: i.streamId ?? o.streamId,
          streamTitle: i.streamTitle ?? o.streamTitle,
        })),
        streamId: o.streamId,
        streamTitle: o.streamTitle,
        cartExpiresAt: o.cartExpiresAt,
        cartUpdatedAt: o.cartUpdatedAt,
      };
    } catch {
      return { items: [] };
    }
  }

  private streamCartIndexKey(streamId: string): string {
    return this.redis.streamCartHoldersKey(streamId);
  }

  private async indexCartForStream(userId: string, streamId?: string) {
    if (!streamId) return;
    await this.redis.sadd(this.streamCartIndexKey(streamId), userId);
  }

  private async unindexCartForStream(userId: string, streamId?: string) {
    if (!streamId) return;
    await this.redis.srem(this.streamCartIndexKey(streamId), userId);
  }

  private async clearCart(userId: string, streamId?: string, reason?: string) {
    if (reason) {
      this.logger.log(
        `Clearing cart userId=${userId} streamId=${streamId ?? 'none'} reason=${reason}`,
      );
    }
    // Multi-seller cart: unindex every stream the cart touched.
    const state = await this.loadCartState(userId);
    const streamIds = new Set<string>(
      state.items.map((i) => i.streamId).filter((s): s is string => !!s),
    );
    if (streamId) streamIds.add(streamId);
    if (state.streamId) streamIds.add(state.streamId);
    await this.redis.del(this.cartKey(userId));
    for (const sid of streamIds) {
      await this.unindexCartForStream(userId, sid);
    }
  }

  /** Buyer-initiated empty cart (e.g. switch lives from the app). */
  async clearCartForBuyer(userId: string) {
    const state = await this.loadCartState(userId);
    await this.clearCart(userId, state.streamId, 'buyer cleared cart');
    return this.getCart(userId);
  }

  /**
   * Post-live cart deadline: the later of 24h after the stream ended and the
   * archive expiry. Archives kept forever get a rolling 24h from cart activity.
   */
  private computeExpiryFromEnd(
    effectiveEnd: Date,
    archive?: StreamArchiveWindow | null,
  ): Date {
    const windowMs = POST_LIVE_CART_HOURS * 60 * 60 * 1000;
    const minExpiry = new Date(effectiveEnd.getTime() + windowMs);
    if (!archive) return minExpiry;

    const hours = normalizeArchiveRetentionHours(archive.archiveRetentionHours);
    const archiveExpiry =
      hours === ARCHIVE_RETENTION_FOREVER
        ? new Date(Date.now() + windowMs)
        : (archive.archiveExpiresAt ??
          computeArchiveExpiresAt(effectiveEnd, hours));
    return archiveExpiry && archiveExpiry > minExpiry ? archiveExpiry : minExpiry;
  }

  /**
   * No-op (B7): cart items never expire. Kept so callers compile.
   */
  async enforceCartExpiry(userId: string, state: CartState): Promise<CartState> {
    void userId;
    return state;
  }

  /** Called when a stream ends — keep indexed carts forever (B7); no expiry rewrite. */
  async onStreamEnded(streamId: string, endedAt: Date) {
    const holders = await this.redis.smembers(this.streamCartIndexKey(streamId));
    this.logger.log(
      `Stream ended streamId=${streamId} endedAt=${endedAt.toISOString()} keeping ${holders.length} cart(s) (no expiry)`,
    );
    for (const userId of holders) {
      const state = await this.loadCartState(userId);
      if (!state.items.length || !state.items.some((i) => i.streamId === streamId)) {
        await this.unindexCartForStream(userId, streamId);
        continue;
      }
      await this.saveCartState(userId, state);
    }
  }

  /** No-op (B7): carts never expire, so the cron sweep clears nothing. */
  async sweepAllCarts(): Promise<number> {
    this.logger.debug('Cart sweep skipped (cart expiry removed)');
    return 0;
  }

  private async loadCartForUser(userId: string): Promise<CartState> {
    const state = await this.loadCartState(userId);
    return this.enforceCartExpiry(userId, state);
  }

  private async saveCartState(userId: string, state: CartState, ttlSeconds?: number) {
    if (!state.items.length) {
      await this.clearCart(userId, state.streamId);
      return;
    }
    const { cartExpiresAt: _legacyExpiry, ...rest } = state;
    void _legacyExpiry;
    // Keep the primary stream pointing at a stream that still has lines.
    const primaryStreamId = state.items.some((i) => i.streamId === state.streamId)
      ? state.streamId
      : [...state.items].reverse().find((i) => i.streamId)?.streamId ??
        state.streamId;
    const payload: CartState = {
      ...rest,
      streamId: primaryStreamId,
      cartUpdatedAt: new Date().toISOString(),
    };
    // Cart items never expire (B7): always use the long safety TTL.
    void ttlSeconds;
    await this.redis.set(
      this.cartKey(userId),
      JSON.stringify(payload),
      CART_REDIS_TTL_SECONDS,
    );
    const indexed = new Set<string>(
      state.items.map((i) => i.streamId).filter((s): s is string => !!s),
    );
    if (primaryStreamId) indexed.add(primaryStreamId);
    for (const sid of indexed) {
      await this.indexCartForStream(userId, sid);
    }
  }

  private async persistCartState(userId: string, state: CartState) {
    if (!state.items.length) {
      await this.clearCart(userId, state.streamId);
      return;
    }
    await this.saveCartState(userId, state);
  }

  async getCart(userId: string) {
    const state = await this.loadCartForUser(userId);
    const { items, streamId, streamTitle } = state;
    if (!items.length) {
      return {
        items: [],
        subtotal: 0,
        mrpSubtotal: 0,
        discountTotal: 0,
        shipping: 0,
        total: 0,
        streamId: null,
        streamTitle: null,
        checkoutExpiresAt: null,
        secondsRemaining: 0,
      };
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        variants: true,
        mrp: true,
        discountPercent: true,
        description: true,
        brand: true,
        material: true,
        stock: true,
        suitableForOccasion: true,
        sellerId: true,
        seller: { select: { businessName: true } },
      },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const normalized = items
      .map((item) => {
        const product = map.get(item.productId);
        if (!product) return null;
        const hasVariants = productHasVariantItems(product.variants);
        let unitPrice = product.price;
        let unitMrp = product.mrp ?? null;
        let lineStock = product.stock;
        if (hasVariants) {
          if (!item.variantId) return null;
          const v = findVariantItem(product.variants, item.variantId);
          if (!v) return null;
          unitPrice = v.sellingPrice;
          lineStock = v.stock;
          if (v.mrp != null && !Number.isNaN(Number(v.mrp))) {
            unitMrp = Number(v.mrp);
          }
        }
        let discountPercent = product.discountPercent ?? null;
        if (
          (discountPercent == null || discountPercent <= 0) &&
          unitMrp != null &&
          unitMrp > unitPrice
        ) {
          discountPercent = Math.max(
            1,
            Math.round(((unitMrp - unitPrice) / unitMrp) * 100),
          );
        }
        return {
          ...item,
          product: {
            id: product.id,
            name: product.name,
            price: unitPrice,
            mrp: unitMrp,
            discountPercent,
            images: product.images,
            description: product.description ?? null,
            brand: product.brand ?? null,
            material: product.material ?? null,
            // Line-available stock (variant when applicable) for client qty caps — not shown in UI.
            stock: lineStock,
            suitableForOccasion: product.suitableForOccasion ?? null,
            variants: product.variants ?? null,
            sellerName: product.seller?.businessName ?? null,
            sellerId: product.sellerId,
          },
          unitPrice,
          unitMrp,
          discountPercent,
          amount: unitPrice * item.quantity,
          mrpAmount:
            unitMrp != null && unitMrp > unitPrice
              ? unitMrp * item.quantity
              : null,
        };
      })
      .filter(Boolean) as Array<
      CartItemDto & {
        product: {
          id: string;
          name: string;
          price: number;
          mrp: number | null;
          discountPercent: number | null;
          images: string[];
          description: string | null;
          brand: string | null;
          material: string | null;
          stock: number;
          suitableForOccasion: string | null;
          variants: unknown;
          sellerName: string | null;
          sellerId: string;
        };
        unitPrice: number;
        unitMrp: number | null;
        discountPercent: number | null;
        amount: number;
        mrpAmount: number | null;
      }
    >;

    const subtotal = normalized.reduce((sum, i) => sum + i.amount, 0);
    const mrpSubtotal = normalized.reduce(
      (sum, i) => sum + (i.mrpAmount ?? i.amount),
      0,
    );
    const discountTotal = Math.max(0, mrpSubtotal - subtotal);
    // Shipping is quoted via Delhivery only at checkout — never bake a flat fee into cart.
    const shipping = 0;
    const total = subtotal;

    // Cart items never expire (B7).
    return {
      items: normalized,
      subtotal,
      mrpSubtotal,
      discountTotal,
      shipping,
      total,
      streamId: streamId ?? null,
      streamTitle: streamTitle?.trim() || null,
      checkoutExpiresAt: null,
      secondsRemaining: 0,
    };
  }

  async addCartItem(userId: string, dto: CartItemDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, stock: true, variants: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const hasVariants = productHasVariantItems(product.variants);
    let availableStock = product.stock;
    if (hasVariants) {
      if (!dto.variantId?.trim()) {
        throw new BadRequestException('variantId is required for this product');
      }
      const v = findVariantItem(product.variants, dto.variantId);
      if (!v) throw new BadRequestException('Invalid variant');
      availableStock = v.stock;
    }
    const maxAllowed = Math.min(MAX_CART_LINE_QUANTITY, Math.max(0, availableStock));
    if (maxAllowed < 1) {
      throw new BadRequestException('This item is out of stock');
    }
    if (dto.quantity > maxAllowed) {
      throw new BadRequestException(
        `You can add at most ${maxAllowed} of this item`,
      );
    }

    // B8: the cart keeps lines from any stream/seller — never wiped on stream switch.
    const state = await this.loadCartForUser(userId);
    const items = [...state.items];
    const vKey = dto.variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) => i.productId === dto.productId && (i.variantId?.trim() ?? '') === vKey,
    );

    // Same product+variant: increment quantity (not set).
    const nextQuantity = (idx >= 0 ? items[idx].quantity : 0) + dto.quantity;
    if (nextQuantity > maxAllowed) {
      throw new BadRequestException(
        `You can add at most ${maxAllowed} of this item`,
      );
    }

    const streamId =
      dto.streamId ?? (idx >= 0 ? items[idx].streamId : undefined) ?? state.streamId;
    if (!streamId) {
      throw new BadRequestException(
        'streamId is required — add products from a live stream.',
      );
    }
    // Block cart lines that are not on this live listing (store API used to expose full catalog).
    await this.assertStreamAndProducts(streamId, [dto.productId]);

    const streamTitle =
      dto.streamTitle?.trim() ||
      (idx >= 0 ? items[idx].streamTitle?.trim() : undefined) ||
      undefined;
    if (idx >= 0) {
      items[idx].quantity = nextQuantity;
      items[idx].size = dto.size ?? items[idx].size;
      items[idx].color = dto.color ?? items[idx].color;
      items[idx].variantId = dto.variantId?.trim();
      items[idx].variantLabel = dto.variantLabel?.trim();
      items[idx].streamId = streamId;
      items[idx].streamTitle = streamTitle;
    } else {
      items.push({
        productId: dto.productId,
        quantity: dto.quantity,
        size: dto.size,
        color: dto.color,
        variantId: dto.variantId?.trim(),
        variantLabel: dto.variantLabel?.trim(),
        streamId,
        streamTitle,
      });
    }
    await this.persistCartState(userId, {
      items,
      streamId,
      streamTitle: streamTitle ?? state.streamTitle,
    });
    return this.getCart(userId);
  }

  async updateCartItem(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ) {
    if (quantity < 1) {
      return this.removeCartItem(userId, productId, variantId);
    }
    const state = await this.loadCartForUser(userId);
    const items = [...state.items];
    const vKey = variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) =>
        i.productId === productId && (i.variantId?.trim() ?? '') === vKey,
    );
    if (idx < 0) throw new NotFoundException('Item not found in cart');

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { stock: true, variants: true, name: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    let availableStock = product.stock;
    if (productHasVariantItems(product.variants)) {
      const vid = variantId?.trim();
      if (!vid) throw new BadRequestException('variantId is required for this product');
      const v = findVariantItem(product.variants, vid);
      if (!v) throw new BadRequestException('Invalid variant');
      availableStock = v.stock;
    }
    const maxAllowed = Math.min(MAX_CART_LINE_QUANTITY, Math.max(0, availableStock));
    if (quantity > maxAllowed) {
      throw new BadRequestException(
        `You can add at most ${maxAllowed} of this item`,
      );
    }

    items[idx].quantity = quantity;
    await this.persistCartState(userId, {
      items,
      streamId: state.streamId,
      streamTitle: state.streamTitle,
      cartExpiresAt: state.cartExpiresAt,
    });
    return this.getCart(userId);
  }

  async removeCartItem(userId: string, productId: string, variantId?: string) {
    const state = await this.loadCartForUser(userId);
    const vKey = variantId?.trim() ?? '';
    const next = state.items.filter(
      (i) =>
        !(
          i.productId === productId && (i.variantId?.trim() ?? '') === vKey
        ),
    );
    await this.persistCartState(
      userId,
      next.length
        ? {
            items: next,
            streamId: state.streamId,
            streamTitle: state.streamTitle,
            cartExpiresAt: state.cartExpiresAt,
          }
        : { items: [] },
    );
    return this.getCart(userId);
  }

  /** Resolve buyer shipping address (any type on file for this user). */
  async resolveShippingAddressOrThrow(userId: string, addressId: string) {
    const id = addressId?.trim();
    if (!id) {
      throw new BadRequestException('Shipping address is required');
    }
    const addr = await this.prisma.address.findFirst({
      where: { id, userId },
    });
    if (!addr) {
      throw new BadRequestException('Shipping address not found');
    }
    return { addr, formatted: formatAddressLine(addr) };
  }

  /**
   * Full pre-payment validation: cart, stream, address, delivery quote, totals.
   * Call before opening Razorpay so payment success never hits a failed checkout.
   * Optional couponCode applies discount to payable total (subtotal + buyerDeliveryFee).
   */
  async prepareCheckoutForPayment(
    userId: string,
    addressId: string,
    couponCode?: string | null,
  ) {
    await this.validateCartForCheckout(userId);

    const cart = await this.getCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    // Primary stream (most recently added) — informational for multi-seller carts.
    const streamId =
      (cart as { streamId?: string | null }).streamId ??
      cart.items.find((i) => i.streamId)?.streamId;
    if (!streamId) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }

    const { formatted: shippingAddress } =
      await this.resolveShippingAddressOrThrow(userId, addressId);

    const shippingPayer = await this.appConfig.getShippingPayer();

    let actualDeliveryFee = 0;
    let deliveryProvider: string | null = null;
    let sellerDeliveryFees: Record<string, number> = {};
    try {
      const quote = await this.getDeliveryQuoteFromCart(userId, addressId);
      actualDeliveryFee = quote?.fee ?? 0;
      deliveryProvider = quote?.provider ?? null;
      sellerDeliveryFees = quote?.sellerFees ?? {};
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      actualDeliveryFee = 0;
    }

    const buyerDeliveryFee = this.buyerDeliveryFeeFor(
      shippingPayer,
      actualDeliveryFee,
    );
    const subtotal = cart.subtotal ?? 0;
    const eligibleBase = subtotal + buyerDeliveryFee;

    let couponId: string | null = null;
    let appliedCouponCode: string | null = null;
    let couponDiscount = 0;

    const rawCode = couponCode?.trim();
    if (rawCode) {
      const coupon = await this.coupons.findActiveByCode(rawCode);
      this.coupons.assertApplicable(coupon, eligibleBase);
      couponDiscount = this.coupons.computeDiscount(coupon, eligibleBase);
      couponId = coupon.id;
      appliedCouponCode = coupon.code;
    }

    const total = Math.round((eligibleBase - couponDiscount) * 100) / 100;
    if (total <= 0) {
      throw new BadRequestException('Cart total must be greater than zero');
    }

    return {
      subtotal,
      /** Actual Delhivery fee (always stored on the order). */
      deliveryFee: actualDeliveryFee,
      /** Amount charged to the buyer (0 when seller pays). */
      buyerDeliveryFee,
      shippingPayer,
      total,
      streamId,
      shippingAddress,
      deliveryProvider,
      /** Per-seller Delhivery fee (multi-seller cart); sums to `deliveryFee`. */
      sellerDeliveryFees,
      couponId,
      couponCode: appliedCouponCode,
      couponDiscount,
    };
  }

  /** Subtotal + delivery + total for Razorpay order creation. */
  async getCheckoutTotals(
    userId: string,
    addressId?: string,
    couponCode?: string | null,
  ) {
    if (!addressId?.trim()) {
      throw new BadRequestException('Shipping address is required');
    }
    const prep = await this.prepareCheckoutForPayment(
      userId,
      addressId,
      couponCode,
    );
    return {
      subtotal: prep.subtotal,
      deliveryFee: prep.deliveryFee,
      buyerDeliveryFee: prep.buyerDeliveryFee,
      shippingPayer: prep.shippingPayer,
      total: prep.total,
      streamId: prep.streamId,
      couponId: prep.couponId,
      couponCode: prep.couponCode,
      couponDiscount: prep.couponDiscount,
    };
  }

  toCheckoutResponse(order: {
    id: string;
    status: OrderStatus;
    totalAmount: number;
    deliveryFee?: number | null;
    shippingPayer?: ShippingPayer | null;
    shippingAddress?: string | null;
  }) {
    const shippingPayer = order.shippingPayer ?? ShippingPayer.SELLER_PAYS;
    const actualFee = order.deliveryFee ?? 0;
    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      deliveryFee: actualFee,
      buyerDeliveryFee: this.buyerDeliveryFeeFor(shippingPayer, actualFee),
      shippingPayer,
      estimatedDelivery: 'October 20, 2024',
      shippingAddress: order.shippingAddress ?? '',
      paymentMethod: 'RAZORPAY',
    };
  }

  /** Idempotent replay response for a payment that produced one or more orders. */
  toCheckoutResponseMany(
    orders: Array<Parameters<OrdersService['toCheckoutResponse']>[0]>,
  ) {
    const base = this.toCheckoutResponse(orders[0]);
    if (orders.length === 1) return base;
    const sum = (f: (o: (typeof orders)[number]) => number) =>
      Math.round(orders.reduce((s, o) => s + f(o), 0) * 100) / 100;
    return {
      ...base,
      orderIds: orders.map((o) => o.id),
      totalAmount: sum((o) => o.totalAmount),
      deliveryFee: sum((o) => o.deliveryFee ?? 0),
      buyerDeliveryFee: sum((o) =>
        this.buyerDeliveryFeeFor(
          o.shippingPayer ?? ShippingPayer.SELLER_PAYS,
          o.deliveryFee ?? 0,
        ),
      ),
    };
  }

  private assertDirectCheckoutAllowed() {
    const flag = this.config.get<string>('PAYMENTS_ALLOW_DIRECT_CHECKOUT');
    if (flag === 'true' || flag === '1') return;
    throw new BadRequestException(
      'Please complete payment via Razorpay to place your order.',
    );
  }

  async checkoutFromCart(
    userId: string,
    dto: CheckoutOrderDto,
    options?: {
      markPaid?: boolean;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      /** Actual Delhivery fee (always persisted). */
      deliveryFee?: number;
      /** Per-seller actual Delhivery fees from the payment session (multi-seller). */
      sellerDeliveryFees?: Record<string, number>;
      /** Amount charged to buyer; when omitted, derived from shippingPayer. */
      buyerDeliveryFee?: number;
      shippingPayer?: ShippingPayer;
      deliveryProvider?: string | null;
      couponId?: string | null;
      couponCode?: string | null;
      couponDiscount?: number;
    },
  ) {
    if (!options?.markPaid) {
      this.assertDirectCheckoutAllowed();
    }

    await this.validateCartForCheckout(userId);

    const cart = await this.getCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    if (cart.items.some((i) => !i.streamId)) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }
    const primaryStreamId =
      (cart as { streamId?: string | null }).streamId ??
      (cart.items[0].streamId as string);

    /**
     * B8 multi-seller checkout (one address, one payment): Order is single-seller
     * (shipping, packing, payout and Delhivery are all per order), so we create
     * ONE ORDER PER SELLER from the whole cart. All sibling orders share the same
     * Razorpay order/payment ids (unique constraints dropped in migration
     * 20261119000000). Delivery fees are quoted per seller; any coupon discount
     * is split pro-rata across the orders.
     */
    const groups = this.groupCartBySeller(cart);

    let shippingAddressText = dto.shippingAddress;
    if (dto.addressId?.trim()) {
      const { formatted } = await this.resolveShippingAddressOrThrow(
        userId,
        dto.addressId,
      );
      shippingAddressText = formatted;
    } else if (!dto.shippingAddress?.trim()) {
      throw new BadRequestException('Shipping address is required');
    }

    const shippingPayer =
      options?.shippingPayer ?? (await this.appConfig.getShippingPayer());

    const needQuote =
      !!dto.addressId?.trim() &&
      (options?.deliveryFee === undefined ||
        (groups.length > 1 && !options?.sellerDeliveryFees));
    const quote = needQuote
      ? await this.getDeliveryQuoteFromCart(userId, dto.addressId!).catch(
          () => null,
        )
      : null;

    const feeForGroup = (g: SellerCheckoutGroup): number => {
      const fromSession = options?.sellerDeliveryFees?.[g.sellerId];
      if (fromSession !== undefined) return fromSession;
      if (groups.length === 1) return options?.deliveryFee ?? quote?.fee ?? 0;
      return quote?.sellerFees?.[g.sellerId] ?? 0;
    };

    const createdOrderIds: string[] = [];
    let committed = false;
    try {
      const created: Array<{
        id: string;
        itemsTotal: number;
        actualFee: number;
        buyerFee: number;
      }> = [];
      for (const g of groups) {
        const order = await this.create(
          {
            items: g.items,
            shippingAddress: shippingAddressText,
            streamId: g.streamId,
          },
          userId,
          { itemsPreValidated: true },
        );
        if (!order) {
          throw new BadRequestException('Order creation failed');
        }
        createdOrderIds.push(order.id);
        const actualFee = feeForGroup(g);
        const buyerFee =
          groups.length === 1 && options?.buyerDeliveryFee !== undefined
            ? options.buyerDeliveryFee
            : this.buyerDeliveryFeeFor(shippingPayer, actualFee);
        created.push({
          id: order.id,
          itemsTotal: order.totalAmount,
          actualFee,
          buyerFee,
        });
      }

      const couponDiscountTotal =
        options?.markPaid && options.couponId
          ? Math.max(0, options.couponDiscount ?? 0)
          : 0;
      const couponId = couponDiscountTotal > 0 ? options?.couponId ?? null : null;
      const couponCode = couponId ? options?.couponCode ?? null : null;

      // Pro-rata coupon split (last order absorbs rounding).
      const bases = created.map((c) => c.itemsTotal + c.buyerFee);
      const baseSum = bases.reduce((a, b) => a + b, 0);
      const discounts: number[] = [];
      let allocated = 0;
      created.forEach((_, idx) => {
        const share =
          idx === created.length - 1
            ? Math.round((couponDiscountTotal - allocated) * 100) / 100
            : baseSum > 0
              ? Math.round(couponDiscountTotal * (bases[idx] / baseSum) * 100) / 100
              : 0;
        allocated += share;
        discounts.push(share);
      });

      const updatedOrders = await this.prisma.$transaction(async (tx) => {
        if (options?.markPaid && couponId) {
          await this.coupons.burnOnPaidOrder(tx, couponId, created[0].id);
        }
        const rows: Array<Awaited<ReturnType<typeof tx.order.update>>> = [];
        for (let idx = 0; idx < created.length; idx++) {
          const c = created[idx];
          const discount = discounts[idx];
          const updateData: Prisma.OrderUpdateInput = {
            deliveryFee: c.actualFee,
            shippingPayer,
            deliveryProvider:
              options?.deliveryProvider ?? quote?.provider ?? undefined,
            totalAmount:
              Math.round((c.itemsTotal + c.buyerFee - discount) * 100) / 100,
            couponId: discount > 0 ? couponId : null,
            couponCode: discount > 0 ? couponCode : null,
            couponDiscount: discount,
          };
          if (options?.markPaid) {
            updateData.status = OrderStatus.PAID;
            if (options.razorpayOrderId) {
              updateData.razorpayOrderId = options.razorpayOrderId;
            }
            if (options.razorpayPaymentId) {
              updateData.razorpayPaymentId = options.razorpayPaymentId;
            }
          }
          rows.push(await tx.order.update({ where: { id: c.id }, data: updateData }));
        }
        return rows;
      });
      committed = true;

      await this.clearCart(userId, primaryStreamId, 'checkout completed');

      for (const updated of updatedOrders) {
        void this.orderNotifications.sendOrderPlacedEmails(updated.id);
        if (updated.status === OrderStatus.PAID) {
          void this.refreshExpectedDelivery(updated.id);
          void this.notifySellerNewOrder(updated.id);
        }
      }

      const actualDeliveryFee = created.reduce((s, c) => s + c.actualFee, 0);
      const buyerDeliveryFee = created.reduce((s, c) => s + c.buyerFee, 0);
      const primary = updatedOrders[0];
      return {
        /** Primary (first seller) order id — kept for older clients. */
        orderId: primary.id,
        orderIds: updatedOrders.map((o) => o.id),
        status: primary.status,
        totalAmount:
          Math.round(updatedOrders.reduce((s, o) => s + o.totalAmount, 0) * 100) /
          100,
        deliveryFee: actualDeliveryFee,
        buyerDeliveryFee,
        shippingPayer,
        couponCode: primary.couponCode ?? updatedOrders.find((o) => o.couponCode)?.couponCode ?? null,
        couponDiscount:
          Math.round(updatedOrders.reduce((s, o) => s + o.couponDiscount, 0) * 100) /
          100,
        estimatedDelivery: 'October 20, 2024',
        shippingAddress: shippingAddressText ?? '',
        paymentMethod: dto.paymentMethod ?? 'CARD',
      };
    } catch (err) {
      // Undo any orders already created (restores stock) so nothing is half-placed.
      if (!committed) await this.rollbackCreatedOrders(createdOrderIds);
      throw err;
    }
  }

  /** Group cart lines by seller (one Order per seller). */
  private groupCartBySeller(cart: {
    items: Array<
      CartItemDto & { amount: number; product: { sellerId: string } }
    >;
  }): SellerCheckoutGroup[] {
    const map = new Map<string, SellerCheckoutGroup>();
    for (const i of cart.items) {
      const sellerId = i.product.sellerId;
      let g = map.get(sellerId);
      if (!g) {
        g = {
          sellerId,
          // Order.streamId = first stream this seller's lines came from.
          streamId: i.streamId as string,
          items: [],
          subtotal: 0,
        };
        map.set(sellerId, g);
      }
      g.items.push({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        variantLabel: i.variantLabel,
      });
      g.subtotal += i.amount;
    }
    return [...map.values()];
  }

  /** Delete just-created PENDING/PAID orders and restore their stock. */
  private async rollbackCreatedOrders(orderIds: string[]): Promise<void> {
    for (const id of orderIds) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const o = await tx.order.findUnique({
            where: { id },
            include: { items: true },
          });
          if (!o) return;
          for (const item of o.items) {
            const p = await tx.product.findUnique({
              where: { id: item.productId },
            });
            if (!p) continue;
            if (item.variantId && productHasVariantItems(p.variants)) {
              const { variants, totalStock } = applyVariantStockDelta(
                p.variants,
                item.variantId,
                item.quantity,
              );
              await tx.product.update({
                where: { id: p.id },
                data: { variants, stock: totalStock },
              });
            } else {
              await tx.product.update({
                where: { id: p.id },
                data: { stock: { increment: item.quantity } },
              });
            }
          }
          await tx.orderItem.deleteMany({ where: { orderId: id } });
          await tx.order.delete({ where: { id } });
        });
      } catch (e) {
        this.logger.error(
          `Failed to roll back order ${id} after checkout error`,
          e instanceof Error ? e.stack : e,
        );
      }
    }
  }

  async getDeliveryQuoteFromCart(userId: string, addressId: string) {
    const cart = await this.getCart(userId);
    if (!cart.items.length) throw new BadRequestException('Cart is empty');
    if (cart.items.some((i) => !i.streamId)) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }

    const buyerAddr = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!buyerAddr) throw new BadRequestException('Shipping address not found');

    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    const buyerPhone = buyer?.phone ?? buyerAddr.phone;
    if (!buyerPhone) throw new BadRequestException('Buyer phone is missing');

    const shippingPayer = await this.appConfig.getShippingPayer();

    // B8: one delivery address, one Delhivery quote per seller; fees are summed.
    const groups = this.groupCartBySeller(cart);
    const sellerFees: Record<string, number> = {};
    let totalFee = 0;
    let buyerTotalFee = 0;
    let provider: string | null = null;
    let configured = true;
    let message: string | undefined;
    let raw: unknown;
    for (const g of groups) {
      const q = await this.quoteDeliveryForSeller(
        g.sellerId,
        buyerAddr,
        g.items.length,
      );
      sellerFees[g.sellerId] = q.fee;
      totalFee += q.fee;
      buyerTotalFee += this.buyerDeliveryFeeFor(shippingPayer, q.fee);
      provider = provider ?? q.provider;
      configured = configured && q.configured;
      message = message ?? q.message;
      raw = raw ?? q.raw;
    }

    return {
      provider,
      fee: totalFee,
      buyerDeliveryFee: buyerTotalFee,
      shippingPayer,
      configured,
      ...(message ? { message } : {}),
      ...(raw !== undefined ? { raw } : {}),
      /** Per-seller actual fee (single-seller carts have one entry). */
      sellerFees,
    };
  }

  /** Delhivery quote from one seller's pickup address to the buyer address. */
  private async quoteDeliveryForSeller(
    sellerId: string,
    buyerAddr: Address,
    itemCount: number,
  ): Promise<{
    provider: string | null;
    fee: number;
    configured: boolean;
    message?: string;
    raw?: unknown;
  }> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      include: { user: true },
    });
    const sellerUserId = seller?.userId;
    if (!seller || !sellerUserId) {
      throw new BadRequestException('Stream seller not found');
    }

    const pickup = await this.prisma.address.findFirst({
      where: { userId: sellerUserId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup) {
      throw new BadRequestException(
        'Seller pickup address is missing. Please update store pickup address.',
      );
    }

    if (!seller.user.phone) {
      throw new BadRequestException('Seller phone is missing for pickup contact');
    }

    const weightGrams = estimateCartWeightGrams(itemCount);
    const originPin = pickup.zip?.trim();
    const destPin = buyerAddr.zip?.trim();
    if (!originPin || !destPin) {
      return {
        provider: this.delhivery.isConfigured() ? 'DELHIVERY' : null,
        fee: 0,
        configured: this.delhivery.isConfigured(),
        message: 'PIN codes required for delivery quote',
      };
    }

    const quote = await this.delhivery.calculateShippingCost({
      originPin,
      destinationPin: destPin,
      weightGrams,
      paymentMode: 'Pre-paid',
    });

    if (!quote) {
      return {
        provider: null,
        fee: 0,
        configured: false,
        message: 'Delivery partner not configured — shipping fee waived for now',
      };
    }

    return {
      provider: 'DELHIVERY',
      fee: quote.fee,
      configured: true,
      raw: quote.raw,
    };
  }

  async create(
    dto: CreateOrderDto,
    userId: string,
    opts?: { itemsPreValidated?: boolean },
  ) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }
    if (!dto.streamId) {
      throw new BadRequestException(
        'Orders are only allowed from a live stream (streamId is required).',
      );
    }

    // Multi-seller checkout validates each line against its own stream beforehand.
    if (!opts?.itemsPreValidated) {
      await this.validateOrderItems(dto.streamId, dto.items);
    }

    const uniqueProductIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: uniqueProductIds } },
      include: { seller: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    let totalAmount = 0;
    const orderItemsData: {
      productId: string;
      quantity: number;
      price: number;
      variantId: string | null;
      variantLabel: string | null;
    }[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId)!;
      const hasVariants = productHasVariantItems(product.variants);
      let linePrice = product.price;
      let variantId: string | null = item.variantId?.trim() ?? null;
      let variantLabel: string | null = item.variantLabel?.trim() ?? null;
      if (hasVariants) {
        const v = findVariantItem(product.variants, item.variantId!);
        linePrice = v!.sellingPrice;
        variantLabel = v!.label;
      }
      totalAmount += linePrice * item.quantity;
      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: linePrice,
        variantId,
        variantLabel,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyerId: buyer.id,
          streamId: dto.streamId,
          shippingAddress: dto.shippingAddress ?? null,
          status: OrderStatus.PENDING,
          totalAmount,
          items: {
            create: orderItemsData.map((r) => ({
              productId: r.productId,
              quantity: r.quantity,
              price: r.price,
              variantId: r.variantId,
              variantLabel: r.variantLabel,
            })),
          },
        },
      });
      for (const row of orderItemsData) {
        const p = await tx.product.findUnique({ where: { id: row.productId } });
        if (!p) continue;
        if (row.variantId && productHasVariantItems(p.variants)) {
          const { variants, totalStock } = applyVariantStockDelta(
            p.variants,
            row.variantId,
            -row.quantity,
          );
          await tx.product.update({
            where: { id: row.productId },
            data: { variants, stock: totalStock },
          });
        } else {
          await tx.product.update({
            where: { id: row.productId },
            data: { stock: { decrement: row.quantity } },
          });
        }
      }
      return newOrder;
    });

    return this.prisma.order.findUnique({
      where: { id: created.id },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async findMyOrders(
    userId: string,
    query: BuyerOrdersQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    const { page = 1, limit = 20, status, search } = query;
    if (!buyer) {
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }

    const skip = (page - 1) * limit;
    const dateRange = resolveSellerDateRange(query.date);
    const where: Prisma.OrderWhereInput = {
      buyerId: buyer.id,
      ...(status ? { status: status as OrderStatus } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              {
                items: {
                  some: {
                    product: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                include: {
                  seller: { select: { businessName: true, logoUrl: true } },
                },
              },
            },
          },
          replacementRequests: { select: { id: true, status: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: data.map(mapBuyerOrderListItem),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getRecentBuyerOrders(userId: string, limit = 10) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) return [];

    const orders = await this.prisma.order.findMany({
      where: { buyerId: buyer.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: { select: { businessName: true, logoUrl: true } },
              },
            },
          },
        },
        replacementRequests: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 20),
    });
    return orders.map(mapBuyerOrderListItem);
  }

  async getBuyerOrderDetail(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({ where: { userId } });
    if (!buyer) throw new ForbiddenException('User is not a registered buyer');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: buyer.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: { select: { businessName: true, logoUrl: true } },
              },
            },
          },
        },
        replacementRequests: { select: { id: true, status: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.ensureExpectedDelivery(order);
    return mapBuyerOrderDetail(order);
  }

  async getOrderHelp(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!buyer) throw new ForbiddenException('User is not a registered buyer');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, images: true } },
          },
        },
      },
    });
    if (!order || order.buyerId !== buyer.id) {
      throw new NotFoundException('Order not found');
    }

    return {
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        totalAmount: order.totalAmount,
        shippingAddress: order.shippingAddress,
        items: order.items,
      },
      customer: {
        name: buyer.user.name,
        email: buyer.user.email,
        phone: buyer.user.phone,
      },
      support: {
        chatAvailable: true,
        phone:
          this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_PHONE')?.trim() ||
          DEFAULT_SUPPORT_PHONE,
        suggestedQueries: [
          'Issue with this item',
          'Did not get the item',
          'Return or exchange the item',
          'Other issue',
        ],
      },
    };
  }

  async findOne(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: { include: { seller: true } } } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isBuyer = order.buyerId && order.buyer?.userId === userId;
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    const isSeller =
      seller && order.items.some((item) => item.product.sellerId === seller.id);
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }

  /** Seller: list orders that contain at least one of the seller's products */
  async findSellerOrders(
    userId: string,
    query: PaginationQueryDto,
    filter: SellerOrdersQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    // Any order that includes this seller's products (live stream or SQL-seeded / other flows).
    const baseWhere: Prisma.OrderWhereInput = {
      items: { some: { product: { sellerId: seller.id } } },
    };
    let statusClause: Prisma.OrderWhereInput = {};
    if (filter?.status?.includes(',')) {
      const parts = filter.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as OrderStatus[];
      statusClause = { status: { in: parts } };
    } else if (filter?.status) {
      statusClause = { status: filter.status as OrderStatus };
    }
    let where: Prisma.OrderWhereInput = { ...baseWhere, ...statusClause };
    const dateRange =
      resolveSellerDateRange(filter?.date) ??
      resolveSellerDateSpan(filter?.from, filter?.to);
    if (dateRange) {
      where = {
        ...where,
        createdAt: { gte: dateRange.gte, lt: dateRange.lt },
      };
    }

    const include = {
      items: { include: { product: { include: { seller: true } } } },
      buyer: {
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      },
    } as const;

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data: data.map((o) => mapSellerOrder(o)),
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  async getSellerOrderDetail(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    this.ensureExpectedDelivery(order);
    return mapSellerOrder(order);
  }

  /** FCM push to the seller partner(s) of a newly paid order. Never throws. */
  private async notifySellerNewOrder(orderId: string): Promise<void> {
    try {
      if (!this.firebasePush.isEnabled()) return;
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          totalAmount: true,
          items: {
            select: {
              quantity: true,
              product: {
                select: { name: true, seller: { select: { userId: true } } },
              },
            },
          },
        },
      });
      if (!order?.items.length) return;
      const userIds = [
        ...new Set(
          order.items
            .map((i) => i.product.seller?.userId)
            .filter((v): v is string => !!v),
        ),
      ];
      if (!userIds.length) return;
      const devices = await this.prisma.userPushDevice.findMany({
        where: { userId: { in: userIds } },
        select: { fcmToken: true },
      });
      const tokens = devices.map((d) => d.fcmToken);
      if (!tokens.length) return;

      const units = order.items.reduce((s, i) => s + i.quantity, 0);
      const firstName = order.items[0].product.name;
      const more = units > 1 ? ` +${units - 1} more` : '';
      const shortId = orderId.slice(-8).toUpperCase();
      await this.firebasePush.sendToTokensBatched(
        tokens,
        'New order received',
        `Order #${shortId}: ${firstName}${more} · ₹${Math.round(order.totalAmount)}. Open Orders to pack and ship it.`,
        { type: 'SELLER_NEW_ORDER', orderId },
        { android: { channelId: 'seller_orders' } },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Seller new-order push failed order=${orderId}: ${msg}`);
    }
  }

  private readonly expectedDeliveryInFlight = new Set<string>();

  /** Background-fills a missing delivery estimate for an open order. */
  private ensureExpectedDelivery(order: {
    id: string;
    status: OrderStatus;
    expectedDeliveryAt?: Date | null;
  }): void {
    if (order.expectedDeliveryAt) return;
    const open: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PACKED,
      OrderStatus.SHIPPED,
    ];
    if (!open.includes(order.status)) return;
    void this.refreshExpectedDelivery(order.id);
  }

  /**
   * Computes the delivery estimate from Delhivery's expected TAT for the
   * seller-pickup → buyer lane and stores it on the order. Never throws.
   */
  private async refreshExpectedDelivery(orderId: string): Promise<void> {
    if (this.expectedDeliveryInFlight.has(orderId)) return;
    this.expectedDeliveryInFlight.add(orderId);
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          shippedAt: true,
          shippingAddress: true,
          items: { select: { product: { select: { sellerId: true } } }, take: 1 },
        },
      });
      if (!order) return;
      const sellerId = order.items[0]?.product.sellerId;
      const destinationPin =
        order.shippingAddress?.match(/\b(\d{6})\b/)?.[1] ?? '';
      if (!sellerId || !destinationPin) return;
      const seller = await this.prisma.seller.findUnique({
        where: { id: sellerId },
        select: { userId: true },
      });
      if (!seller) return;
      const pickup = await this.prisma.address.findFirst({
        where: { userId: seller.userId, type: AddressType.PICKUP },
        orderBy: { createdAt: 'desc' },
        select: { zip: true },
      });
      const originPin = pickup?.zip?.trim() ?? '';
      if (originPin.length !== 6) return;

      const pickupAt =
        order.shippedAt ??
        new Date(Date.now() + PRE_PICKUP_DAYS * 24 * 60 * 60 * 1000);
      const tatDays =
        (await this.delhivery.getExpectedTatDays({
          originPin,
          destinationPin,
          pickupAt,
        })) ?? fallbackTatDays(originPin, destinationPin);
      const expectedDeliveryAt = new Date(
        pickupAt.getTime() + tatDays * 24 * 60 * 60 * 1000,
      );
      await this.prisma.order.update({
        where: { id: orderId },
        data: { expectedDeliveryAt },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Expected delivery estimate failed order=${orderId}: ${msg}`);
    } finally {
      this.expectedDeliveryInFlight.delete(orderId);
    }
  }

  /**
   * Seller-facing pickup pre-check. The Delhivery charge itself is never sent to
   * sellers (it is emailed to the records inbox on pickup); `fee` is always null
   * so older app versions don't display it.
   */
  async getSellerDelhiveryQuote(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }

    const pickup = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    const originPin = pickup?.zip?.trim() ?? '';
    const destPinMatch = order.shippingAddress?.match(/\b(\d{6})\b/);
    const destinationPin = destPinMatch?.[1] ?? '';

    if (!originPin || originPin.length !== 6) {
      throw new BadRequestException(
        'Pickup pincode is missing. Update pickup address in store profile.',
      );
    }
    if (!destinationPin) {
      throw new BadRequestException(
        'Could not find a valid 6-digit pincode in the shipping address.',
      );
    }
    if (!this.delhivery.isConfigured()) {
      throw new ServiceUnavailableException(
        'Delhivery is not configured on the server.',
      );
    }

    const weightGrams = estimateCartWeightGrams(order.items.length);
    return {
      fee: null,
      currency: 'INR',
      originPin,
      destinationPin,
      weightGrams,
      source: 'DELHIVERY',
      note: 'Pickup details verified.',
    };
  }

  /** Seller: get order counts by status for tab badges */
  async getSellerOrderCounts(userId: string, dateParam?: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const baseWhere: Prisma.OrderWhereInput = {
      items: { some: { product: { sellerId: seller.id } } },
    };
    const dateRange = resolveSellerDateRange(dateParam);
    const whereWithDate: Prisma.OrderWhereInput = dateRange
      ? {
          ...baseWhere,
          createdAt: { gte: dateRange.gte, lt: dateRange.lt },
        }
      : baseWhere;

    const [all, newCount, packed, inTransit, delivered] = await Promise.all([
      this.prisma.order.count({ where: whereWithDate }),
      this.prisma.order.count({
        where: { ...whereWithDate, status: OrderStatus.PAID },
      }),
      this.prisma.order.count({
        where: { ...whereWithDate, status: OrderStatus.PACKED },
      }),
      this.prisma.order.count({
        where: { ...whereWithDate, status: OrderStatus.SHIPPED },
      }),
      this.prisma.order.count({
        where: { ...whereWithDate, status: OrderStatus.DELIVERED },
      }),
    ]);
    return {
      all,
      new: newCount,
      packed,
      inTransit,
      delivered,
    };
  }

  /** Seller: accept order (PENDING -> PAID) */
  async acceptOrder(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        'Only pending orders can be accepted. Current status: ' + order.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAID },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Seller: mark order as shipped (add tracking). Order must contain seller's products and be PAID. */
  async shipOrder(orderId: string, userId: string, dto: ShipOrderDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const existingOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!existingOrder) throw new NotFoundException('Order not found');
    const hasSellerProduct = existingOrder.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (existingOrder.streamId) {
      throw new BadRequestException(
        'Live-originated orders use packing video and “Request delivery” instead of manual shipping.',
      );
    }
    if (existingOrder.status !== OrderStatus.PAID) {
      throw new BadRequestException(
        'Only paid orders can be marked as shipped. Current status: ' +
          existingOrder.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        trackingId: dto.trackingId,
        carrierName: dto.carrierName,
        shippedAt: new Date(),
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Seller: mark order as delivered. Order must contain seller's products and be SHIPPED. */
  async deliverOrder(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const existingOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!existingOrder) throw new NotFoundException('Order not found');
    const hasSellerProduct = existingOrder.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (existingOrder.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException(
        'Only shipped orders can be marked as delivered. Current status: ' +
          existingOrder.status,
      );
    }

    const order = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (order.buyerId) {
      await this.ratings.recordDeliveredOrder(order.buyerId);
    }
    return order;
  }

  /** Buyer: cancel own order. Only PENDING or PAID orders can be cancelled. Restores stock. */
  async cancelOrder(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyer.id) {
      throw new ForbiddenException('You can only cancel your own orders');
    }
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.PACKED
    ) {
      throw new BadRequestException(
        'Only pending, paid, or packed orders can be cancelled. Current status: ' +
          order.status,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const p = await tx.product.findUnique({ where: { id: item.productId } });
        if (!p) continue;
        if (item.variantId && productHasVariantItems(p.variants)) {
          const { variants, totalStock } = applyVariantStockDelta(
            p.variants,
            item.variantId,
            item.quantity,
          );
          await tx.product.update({
            where: { id: item.productId },
            data: { variants, stock: totalStock },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });
    });

    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  /** Buyer: request return on delivered order. */
  async returnOrder(orderId: string, userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) {
      throw new ForbiddenException('User is not a registered buyer');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyer.id) {
      throw new ForbiddenException('You can only return your own orders');
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Only delivered orders can be returned. Current status: ' +
          order.status,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.RETURNED },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  async uploadPackingVideo(
    orderId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Video file is required');
    }
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.streamId) {
      throw new BadRequestException('Packing video applies to live stream orders only');
    }
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException(
        'Order must be accepted (paid) before packing. Status: ' + order.status,
      );
    }
    const ext = path.extname(file.originalname) || '.mp4';
    const packingVideoUrl = await this.packingVideos.save(
      `packing/${orderId}${ext}`,
      file,
    );
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        packingVideoUrl,
        packedAt: new Date(),
        status: OrderStatus.PACKED,
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });
    return mapSellerOrder(updated);
  }

  async requestDeliveryFromPartner(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        buyer: { include: { user: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.streamId) {
      throw new BadRequestException('Only live-originated orders use this action');
    }
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.status !== OrderStatus.PACKED) {
      throw new BadRequestException(
        'Order must be packed first. Current status: ' + order.status,
      );
    }

    const pickup = await this.prisma.address.findFirst({
      where: { userId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup) {
      throw new BadRequestException(
        'Pickup address is missing. Please update pickup address in store profile.',
      );
    }
    const buyerPhone = order.buyer?.user?.phone;
    if (!buyerPhone) throw new BadRequestException('Buyer phone is missing');
    const dropAddress = order.shippingAddress?.trim();
    if (!dropAddress) {
      throw new BadRequestException('Order shipping address is missing');
    }

    const destPinMatch = dropAddress.match(/\b(\d{6})\b/);
    const destPin = destPinMatch?.[1] ?? '';
    const originPin = pickup.zip?.trim() ?? '';

    let shipmentData: Awaited<ReturnType<DelhiveryService['createShipment']>> = null;

    if (!originPin || originPin.length !== 6) {
      throw new BadRequestException(
        'Pickup pincode is missing or invalid. Update pickup address in store profile.',
      );
    }
    if (!destPin || destPin.length !== 6) {
      throw new BadRequestException(
        'Could not find a valid 6-digit pincode in the shipping address.',
      );
    }

    if (!this.delhivery.isConfigured()) {
      throw new ServiceUnavailableException(
        'Delhivery is not configured on the server. Contact support.',
      );
    }

    const pickupLocationName = await this.delhiveryWarehouses.ensureForSeller(
      seller.id,
      { throwOnFailure: true },
    );
    if (!pickupLocationName) {
      throw new BadRequestException(
        'Could not register seller pickup with Delhivery. Update pickup address and try again.',
      );
    }

    const weightGrams = estimateCartWeightGrams(order.items.length);
    shipmentData = await this.delhivery.createShipment({
      orderId: orderId.replace(/-/g, '').slice(0, 32),
      pickupLocationName,
      originPin,
      destinationPin: destPin,
      consigneeName: order.buyer?.user?.name ?? 'Buyer',
      consigneePhone: normalizeInPhone(buyerPhone),
      consigneeAddress: dropAddress,
      weightGrams,
      paymentMode: 'Pre-paid',
      shippingMode: 'Express',
    });

    if (!shipmentData?.waybill) {
      const detail = this.delhivery.formatCreateShipmentFailure(shipmentData?.raw);
      this.logger.warn(
        `request-delivery failed order=${orderId} pickup=${pickupLocationName} detail=${detail}`,
      );
      throw new BadRequestException(
        `Delhivery could not create shipment. ${detail}`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        shippedAt: new Date(),
        carrierName: 'Delhivery',
        trackingId: shipmentData.waybill,
        deliveryProvider: 'DELHIVERY',
        borzoTrackingUrl: shipmentData.trackingUrl,
        borzoOrderStatus: shipmentData.status,
        deliveryStatus: shipmentData.status ?? 'Created',
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });
    void this.refreshExpectedDelivery(orderId);
    const waybill = shipmentData.waybill;
    void this.delhivery
      .calculateShippingCost({
        originPin,
        destinationPin: destPin,
        weightGrams,
        paymentMode: 'Pre-paid',
      })
      .catch(() => null)
      .then((quote) =>
        this.orderNotifications.sendDelhiveryChargeRecord({
          kind: 'ORDER',
          referenceId: orderId,
          orderId,
          sellerName: seller.businessName?.trim() || seller.id,
          waybill,
          originPin,
          destinationPin: destPin,
          weightGrams,
          quote,
        }),
      );
    return mapSellerOrder(updated);
  }

  async getOrderDeliveryStatus(orderId: string, userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const hasSellerProduct = order.items.some(
      (item) => item.product.sellerId === seller.id,
    );
    if (!hasSellerProduct) {
      throw new ForbiddenException('This order does not contain your products');
    }
    if (order.deliveryProvider === 'DELHIVERY' && order.trackingId) {
      const track = await this.delhivery.trackShipment(order.trackingId);
      const status = track?.status ?? order.deliveryStatus ?? null;
      const markDelivered = isDelhiveryDeliveredStatus(status);
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          deliveryStatus: status ?? order.deliveryStatus,
          borzoOrderStatus: status ?? order.borzoOrderStatus,
          ...(track?.expectedDeliveryDate
            ? { expectedDeliveryAt: track.expectedDeliveryDate }
            : {}),
          ...(markDelivered
            ? {
                status: OrderStatus.DELIVERED,
                deliveredAt: order.deliveredAt ?? new Date(),
              }
            : {}),
        },
        include: {
          items: { include: { product: true } },
          buyer: {
            include: {
              user: {
                select: { id: true, name: true, email: true, phone: true },
              },
            },
          },
        },
      });
      this.ensureExpectedDelivery(updated);
      return {
        deliveryStatus: updated.deliveryStatus,
        trackingId: updated.trackingId,
        carrierName: updated.carrierName,
        orderStatus: updated.status,
        order: mapSellerOrder(updated),
        delhivery: {
          waybill: updated.trackingId,
          trackingUrl: updated.borzoTrackingUrl,
        },
      };
    }

    this.mockDelivery.touchPoll(orderId);
    const live = this.mockDelivery.getDeliveryStatus(orderId);
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { deliveryStatus: live },
    });
    return {
      deliveryStatus: updated.deliveryStatus,
      trackingId: updated.trackingId,
      carrierName: updated.carrierName,
      orderStatus: updated.status,
    };
  }
}

function buildMatterFromCart(items: CartItemDto[]): string {
  const n = items.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  return `Vybekart live order (${n} item${n === 1 ? '' : 's'})`;
}

function normalizeInPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  return digits;
}

/** Packing + pickup lead time before Delhivery collects a newly paid order. */
const PRE_PICKUP_DAYS = 1;

/** Used only when Delhivery's expected TAT API gives no answer. */
function fallbackTatDays(originPin: string, destinationPin: string): number {
  if (originPin.slice(0, 3) === destinationPin.slice(0, 3)) return 2;
  if (originPin.slice(0, 2) === destinationPin.slice(0, 2)) return 3;
  if (originPin[0] === destinationPin[0]) return 4;
  return 6;
}

/** Rough weight for Delhivery quotes (500g per line, min 500g). */
function estimateCartWeightGrams(itemCount: number): number {
  return Math.max(500, itemCount * 500);
}

function formatAddressLine(
  a: Pick<
    Address,
    | 'line1'
    | 'line2'
    | 'city'
    | 'state'
    | 'zip'
    | 'country'
    | 'contactName'
    | 'phone'
  >,
): string {
  const streetParts = [a.line1, a.line2, a.city, a.state, a.zip, a.country]
    .map((s) => (s ?? '').toString().trim())
    .filter(Boolean);
  const street = streetParts.join(', ');
  const name = (a.contactName ?? '').trim();
  const phone = (a.phone ?? '').trim();
  const lines: string[] = [];
  if (name) lines.push(name);
  if (phone) lines.push(phone);
  if (street) lines.push(street);
  return lines.length ? lines.join('\n') : '—';
}
