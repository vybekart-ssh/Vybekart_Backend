import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { Address, AddressType, OrderStatus, Prisma } from '@prisma/client';
import { RedisService } from '../redis/redis.service';
import { CartItemDto } from './dto/cart-item.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';
import { ConfigService } from '@nestjs/config';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';
import { BuyerOrdersQueryDto } from './dto/buyer-orders-query.dto';
import { MockDeliveryService } from './mock-delivery.service';
import { DelhiveryService } from '../delhivery/delhivery.service';
import { resolvePublicBaseUrl } from '../common/utils/public-base-url';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  applyVariantStockDelta,
  findVariantItem,
  productHasVariantItems,
} from '../products/product-variants.util';
import { RatingsService } from '../ratings/ratings.service';
import { OrderNotificationService } from '../mail/order-notification.service';

const POST_LIVE_CART_HOURS = 24;

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
  ) {}

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
    if (!stream.isLive && stream.endedAt) {
      const expiry = new Date(stream.endedAt);
      expiry.setHours(expiry.getHours() + POST_LIVE_CART_HOURS);
      if (new Date() > expiry) {
        throw new BadRequestException(
          'Your cart from this live stream has expired.',
        );
      }
      // Within 24h post-live window — allow checkout.
    } else if (!stream.isLive) {
      throw new BadRequestException(
        'This stream has ended; you cannot purchase from a replay.',
      );
    } else if (stream.endedAt && stream.isLive) {
      throw new BadRequestException(
        'This stream is no longer available for checkout.',
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
    if (!rawState.streamId) {
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

    await this.validateOrderItems(
      rawState.streamId,
      cart.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        variantLabel: i.variantLabel,
      })),
    );
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
        items: o.items ?? [],
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
    await this.redis.del(this.cartKey(userId));
    await this.unindexCartForStream(userId, streamId);
  }

  private computeExpiryFromEnd(effectiveEnd: Date): Date {
    const expires = new Date(effectiveEnd);
    expires.setHours(expires.getHours() + POST_LIVE_CART_HOURS);
    return expires;
  }

  /**
   * Enforce 24h post-live cart TTL. Persists Redis EXPIRE when still valid.
   * Returns empty items when expired or stream context is invalid.
   */
  async enforceCartExpiry(userId: string, state: CartState): Promise<CartState> {
    if (!state.items.length) {
      return { items: [] };
    }

    const now = Date.now();

    if (state.cartExpiresAt) {
      const expMs = new Date(state.cartExpiresAt).getTime();
      if (now >= expMs) {
        await this.clearCart(
          userId,
          state.streamId,
          'stored cartExpiresAt passed',
        );
        return { items: [] };
      }
    }

    if (!state.streamId) {
      const updatedAt = state.cartUpdatedAt
        ? new Date(state.cartUpdatedAt).getTime()
        : 0;
      const fallbackExpiry =
        updatedAt + POST_LIVE_CART_HOURS * 60 * 60 * 1000;
      if (!updatedAt || now >= fallbackExpiry) {
        await this.clearCart(userId, undefined, 'missing streamId / stale legacy cart');
        return { items: [] };
      }
      return state;
    }

    const stream = await this.prisma.stream.findUnique({
      where: { id: state.streamId },
      select: {
        id: true,
        isLive: true,
        endedAt: true,
        startedAt: true,
        createdAt: true,
        session: { select: { endedAt: true } },
      },
    });

    if (!stream) {
      await this.clearCart(userId, state.streamId, 'stream not found');
      return { items: [] };
    }

    if (stream.isLive) {
      const next: CartState = {
        ...state,
        cartUpdatedAt: new Date().toISOString(),
      };
      await this.saveCartState(userId, next);
      await this.indexCartForStream(userId, state.streamId);
      return next;
    }

    const effectiveEnd =
      stream.endedAt ??
      stream.session?.endedAt ??
      stream.startedAt ??
      stream.createdAt;

    const expires = this.computeExpiryFromEnd(effectiveEnd);
    const ttlSeconds = Math.floor((expires.getTime() - now) / 1000);

    if (ttlSeconds <= 0) {
      await this.clearCart(
        userId,
        state.streamId,
        `post-live window ended (stream ended ${effectiveEnd.toISOString()})`,
      );
      return { items: [] };
    }

    const next: CartState = {
      ...state,
      cartExpiresAt: expires.toISOString(),
      cartUpdatedAt: new Date().toISOString(),
    };
    await this.saveCartState(userId, next, ttlSeconds);
    await this.indexCartForStream(userId, state.streamId);
    this.logger.debug(
      `Cart TTL refreshed userId=${userId} streamId=${state.streamId} ttlSeconds=${ttlSeconds} expiresAt=${expires.toISOString()}`,
    );
    return next;
  }

  /** Called when a stream ends — refresh TTL on all indexed buyer carts. */
  async onStreamEnded(streamId: string, endedAt: Date) {
    const expires = this.computeExpiryFromEnd(endedAt);
    const ttlSeconds = Math.max(
      1,
      Math.floor((expires.getTime() - Date.now()) / 1000),
    );
    const holders = await this.redis.smembers(this.streamCartIndexKey(streamId));
    this.logger.log(
      `Stream ended streamId=${streamId} endedAt=${endedAt.toISOString()} refreshing ${holders.length} cart(s) ttlSeconds=${ttlSeconds}`,
    );
    for (const userId of holders) {
      const state = await this.loadCartState(userId);
      if (!state.items.length || state.streamId !== streamId) {
        await this.unindexCartForStream(userId, streamId);
        continue;
      }
      const next: CartState = {
        ...state,
        cartExpiresAt: expires.toISOString(),
        cartUpdatedAt: new Date().toISOString(),
      };
      await this.saveCartState(userId, next, ttlSeconds);
    }
  }

  /** Sweep all buyer carts (cron) — clears any past post-live window. */
  async sweepAllCarts(): Promise<number> {
    const client = this.redis.getClient();
    let cursor = '0';
    let cleared = 0;
    do {
      const [next, keys] = await client.scan(
        cursor,
        'MATCH',
        'orders:cart:*',
        'COUNT',
        50,
      );
      cursor = next;
      for (const key of keys) {
        const userId = key.replace(/^orders:cart:/, '');
        const before = await this.loadCartState(userId);
        if (!before.items.length) continue;
        const after = await this.enforceCartExpiry(userId, before);
        if (!after.items.length && before.items.length) cleared += 1;
      }
    } while (cursor !== '0');
    if (cleared > 0) {
      this.logger.log(`Cart sweep cleared ${cleared} expired cart(s)`);
    }
    return cleared;
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
    const payload: CartState = {
      ...state,
      cartUpdatedAt: new Date().toISOString(),
    };
    await this.redis.set(this.cartKey(userId), JSON.stringify(payload), ttlSeconds);
    await this.indexCartForStream(userId, state.streamId);
  }

  private async persistCartState(userId: string, state: CartState) {
    if (!state.items.length) {
      await this.clearCart(userId, state.streamId);
      return;
    }
    const enforced = await this.enforceCartExpiry(userId, state);
    if (!enforced.items.length) return;
    if (enforced.cartExpiresAt) {
      const ttl = Math.max(
        1,
        Math.floor(
          (new Date(enforced.cartExpiresAt).getTime() - Date.now()) / 1000,
        ),
      );
      await this.saveCartState(userId, enforced, ttl);
    } else {
      await this.saveCartState(userId, enforced);
    }
  }

  async getCart(userId: string) {
    const state = await this.loadCartForUser(userId);
    const { items, streamId, streamTitle, cartExpiresAt } = state;
    if (!items.length) {
      return {
        items: [],
        subtotal: 0,
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
      select: { id: true, name: true, price: true, images: true, variants: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const normalized = items
      .map((item) => {
        const product = map.get(item.productId);
        if (!product) return null;
        const hasVariants = productHasVariantItems(product.variants);
        let unitPrice = product.price;
        if (hasVariants) {
          if (!item.variantId) return null;
          const v = findVariantItem(product.variants, item.variantId);
          if (!v) return null;
          unitPrice = v.sellingPrice;
        }
        return {
          ...item,
          product: {
            id: product.id,
            name: product.name,
            price: unitPrice,
            images: product.images,
          },
          unitPrice,
          amount: unitPrice * item.quantity,
        };
      })
      .filter(Boolean) as Array<
      CartItemDto & {
        product: { id: string; name: string; price: number; images: string[] };
        unitPrice: number;
        amount: number;
      }
    >;

    const subtotal = normalized.reduce((sum, i) => sum + i.amount, 0);
    const shipping = subtotal > 0 ? 90 : 0;
    const total = subtotal + shipping;

    let checkoutExpiresAt: string | null = cartExpiresAt ?? null;
    let secondsRemaining = 0;
    if (checkoutExpiresAt) {
      secondsRemaining = Math.max(
        0,
        Math.floor((new Date(checkoutExpiresAt).getTime() - Date.now()) / 1000),
      );
      if (secondsRemaining <= 0) {
        await this.clearCart(userId, streamId ?? undefined, 'secondsRemaining zero on getCart');
        return {
          items: [],
          subtotal: 0,
          shipping: 0,
          total: 0,
          streamId: null,
          streamTitle: null,
          checkoutExpiresAt: null,
          secondsRemaining: 0,
        };
      }
    } else if (streamId) {
      const stream = await this.prisma.stream.findUnique({
        where: { id: streamId },
        select: {
          endedAt: true,
          isLive: true,
          startedAt: true,
          createdAt: true,
          session: { select: { endedAt: true } },
        },
      });
      if (stream && !stream.isLive) {
        const effectiveEnd =
          stream.endedAt ??
          stream.session?.endedAt ??
          stream.startedAt ??
          stream.createdAt;
        const expires = this.computeExpiryFromEnd(effectiveEnd);
        checkoutExpiresAt = expires.toISOString();
        secondsRemaining = Math.max(
          0,
          Math.floor((expires.getTime() - Date.now()) / 1000),
        );
      }
    }

    return {
      items: normalized,
      subtotal,
      shipping,
      total,
      streamId: streamId ?? null,
      streamTitle: streamTitle?.trim() || null,
      checkoutExpiresAt,
      secondsRemaining,
    };
  }

  async addCartItem(userId: string, dto: CartItemDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, stock: true, variants: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const hasVariants = productHasVariantItems(product.variants);
    if (hasVariants) {
      if (!dto.variantId?.trim()) {
        throw new BadRequestException('variantId is required for this product');
      }
      const v = findVariantItem(product.variants, dto.variantId);
      if (!v) throw new BadRequestException('Invalid variant');
      if (dto.quantity > v.stock) {
        throw new BadRequestException('Requested quantity exceeds available stock');
      }
    } else if (dto.quantity > product.stock) {
      throw new BadRequestException('Requested quantity exceeds available stock');
    }

    const state = await this.loadCartForUser(userId);
    if (state.items.length === 0 && !dto.streamId) {
      throw new BadRequestException(
        'streamId is required — add products from a live stream.',
      );
    }
    if (
      state.streamId &&
      dto.streamId &&
      dto.streamId !== state.streamId
    ) {
      throw new BadRequestException(
        'Cart is tied to a different live stream. Clear the cart first.',
      );
    }

    const items = [...state.items];
    const streamId = state.streamId ?? dto.streamId;
    const streamTitle =
      state.streamTitle?.trim() ||
      dto.streamTitle?.trim() ||
      undefined;
    const vKey = dto.variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) => i.productId === dto.productId && (i.variantId?.trim() ?? '') === vKey,
    );
    if (idx >= 0) {
      items[idx].quantity = dto.quantity;
      items[idx].size = dto.size;
      items[idx].color = dto.color;
      items[idx].variantId = dto.variantId?.trim();
      items[idx].variantLabel = dto.variantLabel?.trim();
    } else {
      items.push({
        productId: dto.productId,
        quantity: dto.quantity,
        size: dto.size,
        color: dto.color,
        variantId: dto.variantId?.trim(),
        variantLabel: dto.variantLabel?.trim(),
      });
    }
    await this.persistCartState(userId, { items, streamId, streamTitle });
    return this.getCart(userId);
  }

  async updateCartItem(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ) {
    const state = await this.loadCartForUser(userId);
    const items = [...state.items];
    const vKey = variantId?.trim() ?? '';
    const idx = items.findIndex(
      (i) =>
        i.productId === productId && (i.variantId?.trim() ?? '') === vKey,
    );
    if (idx < 0) throw new NotFoundException('Item not found in cart');
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
   */
  async prepareCheckoutForPayment(userId: string, addressId: string) {
    await this.validateCartForCheckout(userId);

    const cart = await this.getCart(userId);
    if (!cart.items.length) {
      throw new BadRequestException('Cart is empty');
    }
    const streamId = (cart as { streamId?: string | null }).streamId;
    if (!streamId) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }

    const { formatted: shippingAddress } =
      await this.resolveShippingAddressOrThrow(userId, addressId);

    let deliveryFee = 0;
    let deliveryProvider: string | null = null;
    try {
      const quote = await this.getDeliveryQuoteFromCart(userId, addressId);
      deliveryFee = quote?.fee ?? 0;
      deliveryProvider = quote?.provider ?? null;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      deliveryFee = 0;
    }

    const subtotal = cart.subtotal ?? 0;
    const total = subtotal + deliveryFee;
    if (total <= 0) {
      throw new BadRequestException('Cart total must be greater than zero');
    }

    return {
      subtotal,
      deliveryFee,
      total,
      streamId,
      shippingAddress,
      deliveryProvider,
    };
  }

  /** Subtotal + delivery + total for Razorpay order creation. */
  async getCheckoutTotals(userId: string, addressId?: string) {
    if (!addressId?.trim()) {
      throw new BadRequestException('Shipping address is required');
    }
    const prep = await this.prepareCheckoutForPayment(userId, addressId);
    return {
      subtotal: prep.subtotal,
      deliveryFee: prep.deliveryFee,
      total: prep.total,
      streamId: prep.streamId,
    };
  }

  toCheckoutResponse(order: {
    id: string;
    status: OrderStatus;
    totalAmount: number;
    deliveryFee?: number | null;
    shippingAddress?: string | null;
  }) {
    return {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee ?? 0,
      estimatedDelivery: 'October 20, 2024',
      shippingAddress: order.shippingAddress ?? '',
      paymentMethod: 'RAZORPAY',
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
      /** When set (Razorpay verify), skip re-quote and use this fee. */
      deliveryFee?: number;
      deliveryProvider?: string | null;
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
    const streamId = (cart as { streamId?: string | null }).streamId;
    if (!streamId) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }
    const createDto: CreateOrderDto = {
      items: cart.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        variantId: i.variantId,
        variantLabel: i.variantLabel,
      })),
      shippingAddress: dto.shippingAddress,
      streamId,
    };

    if (dto.addressId?.trim()) {
      const { formatted } = await this.resolveShippingAddressOrThrow(
        userId,
        dto.addressId,
      );
      createDto.shippingAddress = formatted;
    } else if (!dto.shippingAddress?.trim()) {
      throw new BadRequestException('Shipping address is required');
    }

    const quote =
      dto.addressId?.trim() && options?.deliveryFee === undefined
        ? await this.getDeliveryQuoteFromCart(userId, dto.addressId).catch(
            () => null,
          )
        : null;

    const order = await this.create(createDto, userId);
    if (!order) {
      throw new BadRequestException('Order creation failed');
    }

    const deliveryFee = options?.deliveryFee ?? quote?.fee ?? 0;
    const updateData: Prisma.OrderUpdateInput = {};
    if (deliveryFee > 0) {
      updateData.deliveryFee = deliveryFee;
      updateData.deliveryProvider =
        options?.deliveryProvider ?? quote?.provider ?? undefined;
      updateData.totalAmount = order.totalAmount + deliveryFee;
    }
    if (options?.markPaid) {
      updateData.status = OrderStatus.PAID;
      if (options.razorpayOrderId) {
        updateData.razorpayOrderId = options.razorpayOrderId;
      }
      if (options.razorpayPaymentId) {
        updateData.razorpayPaymentId = options.razorpayPaymentId;
      }
    }

    let orderId = order.id;
    let orderStatus = order.status;
    let orderTotal = order.totalAmount;
    if (Object.keys(updateData).length > 0) {
      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: updateData,
      });
      orderId = updated.id;
      orderStatus = updated.status;
      orderTotal = updated.totalAmount;
    }

    await this.clearCart(userId, streamId ?? undefined, 'checkout completed');

    void this.orderNotifications.sendOrderPlacedEmails(orderId);

    return {
      orderId,
      status: orderStatus,
      totalAmount: orderTotal,
      deliveryFee,
      estimatedDelivery: 'October 20, 2024',
      shippingAddress: createDto.shippingAddress ?? dto.shippingAddress ?? '',
      paymentMethod: dto.paymentMethod ?? 'CARD',
    };
  }

  async getDeliveryQuoteFromCart(userId: string, addressId: string) {
    const cart = await this.getCart(userId);
    if (!cart.items.length) throw new BadRequestException('Cart is empty');
    const streamId = (cart as { streamId?: string | null }).streamId;
    if (!streamId) {
      throw new BadRequestException(
        'Checkout requires a live stream context. Add items from a live.',
      );
    }

    const buyerAddr = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!buyerAddr) throw new BadRequestException('Shipping address not found');

    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      include: { seller: { include: { user: true } } },
    });
    if (!stream) throw new BadRequestException('Stream not found');
    const sellerUserId = stream.seller?.userId;
    if (!sellerUserId) throw new BadRequestException('Stream seller not found');

    const pickup = await this.prisma.address.findFirst({
      where: { userId: sellerUserId, type: AddressType.PICKUP },
      orderBy: { createdAt: 'desc' },
    });
    if (!pickup) {
      throw new BadRequestException(
        'Seller pickup address is missing. Please update store pickup address.',
      );
    }

    const sellerPhone = stream.seller.user.phone;
    if (!sellerPhone) {
      throw new BadRequestException('Seller phone is missing for pickup contact');
    }
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    const buyerPhone = buyer?.phone ?? buyerAddr.phone;
    if (!buyerPhone) throw new BadRequestException('Buyer phone is missing');

    const weightGrams = estimateCartWeightGrams(cart.items.length);
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

  async create(dto: CreateOrderDto, userId: string) {
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

    await this.validateOrderItems(dto.streamId, dto.items);

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
    const where: Prisma.OrderWhereInput = {
      buyerId: buyer.id,
      ...(status ? { status: status as OrderStatus } : {}),
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
        include: { items: { include: { product: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data,
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
          this.config.get<string>('SUPPORT_ACCOUNT_MANAGER_PHONE') ??
          '+91 98765 43210',
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
    if (filter?.date === 'today') {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const todayEnd = new Date(
        todayStart.getTime() + 24 * 60 * 60 * 1000,
      );
      where = {
        ...where,
        createdAt: { gte: todayStart, lt: todayEnd },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { product: { include: { seller: true } } } },
          buyer: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);
    const totalPages = Math.ceil(total / limit);
    return {
      data,
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

  /** Seller: get order counts by status for tab badges */
  async getSellerOrderCounts(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller)
      throw new ForbiddenException('User is not a registered seller');

    const baseWhere: Prisma.OrderWhereInput = {
      items: { some: { product: { sellerId: seller.id } } },
    };
    const [all, pending, processing, packed, shipped] = await Promise.all([
      this.prisma.order.count({ where: baseWhere }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PENDING },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PAID },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PACKED },
      }),
      this.prisma.order.count({
        where: {
          ...baseWhere,
          status: { in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        },
      }),
    ]);
    return {
      all,
      pending,
      processing,
      packed,
      shipped,
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
    const dir = path.join(process.cwd(), 'uploads', 'packing');
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(file.originalname) || '.mp4';
    const fname = `${orderId}${ext}`;
    const dest = path.join(dir, fname);
    await fs.writeFile(dest, file.buffer);
    const base = resolvePublicBaseUrl(this.config);
    const packingVideoUrl = `${base}/uploads/packing/${fname}`;
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        packingVideoUrl,
        packedAt: new Date(),
        status: OrderStatus.PACKED,
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
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
    const sellerUser = await this.prisma.user.findUnique({ where: { id: userId } });
    const buyerPhone = order.buyer?.user?.phone;
    if (!buyerPhone) throw new BadRequestException('Buyer phone is missing');
    const dropAddress = order.shippingAddress?.trim();
    if (!dropAddress) {
      throw new BadRequestException('Order shipping address is missing');
    }

    const destPinMatch = dropAddress.match(/\b(\d{6})\b/);
    const destPin = destPinMatch?.[1] ?? '';
    const originPin = pickup.zip?.trim() ?? '';

    let shipmentData: {
      waybill: string | null;
      trackingUrl: string | null;
      status: string | null;
    } | null = null;

    if (this.delhivery.isConfigured() && originPin && destPin) {
      shipmentData = await this.delhivery.createShipment({
        orderId: orderId.replace(/-/g, '').slice(0, 32),
        pickupLocationName: seller.businessName,
        originPin,
        destinationPin: destPin,
        consigneeName: order.buyer?.user?.name ?? 'Buyer',
        consigneePhone: normalizeInPhone(buyerPhone),
        consigneeAddress: dropAddress,
        weightGrams: estimateCartWeightGrams(order.items.length),
        paymentMode: 'Pre-paid',
      });
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.SHIPPED,
        shippedAt: new Date(),
        carrierName: shipmentData?.waybill ? 'Delhivery' : null,
        trackingId: shipmentData?.waybill ?? null,
        deliveryProvider: shipmentData?.waybill ? 'DELHIVERY' : null,
        borzoTrackingUrl: shipmentData?.trackingUrl,
        borzoOrderStatus: shipmentData?.status,
        deliveryStatus: shipmentData?.status ?? 'REQUESTED',
      },
      include: {
        items: { include: { product: true } },
        buyer: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
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
      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          deliveryStatus: status ?? order.deliveryStatus,
          borzoOrderStatus: status ?? order.borzoOrderStatus,
        },
      });
      return {
        deliveryStatus: updated.deliveryStatus,
        trackingId: updated.trackingId,
        carrierName: updated.carrierName,
        orderStatus: updated.status,
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
  return `VybeKart live order (${n} item${n === 1 ? '' : 's'})`;
}

function normalizeInPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('91') && digits.length === 12) return digits;
  return digits;
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
