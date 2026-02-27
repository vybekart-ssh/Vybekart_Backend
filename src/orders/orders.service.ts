import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { OrderStatus, Prisma } from '@prisma/client';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

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

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { seller: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products not found');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    let totalAmount = 0;
    const orderItemsData: {
      productId: string;
      quantity: number;
      price: number;
    }[] = [];

    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product)
        throw new BadRequestException(`Product ${item.productId} not found`);
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product ${product.name}. Available: ${product.stock}`,
        );
      }
      const lineTotal = product.price * item.quantity;
      totalAmount += lineTotal;
      orderItemsData.push({
        productId: product.id,
        quantity: item.quantity,
        price: product.price,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyerId: buyer.id,
          shippingAddress: dto.shippingAddress ?? null,
          status: OrderStatus.PENDING,
          totalAmount,
          items: {
            create: orderItemsData,
          },
        },
      });
      for (const item of orderItemsData) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
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
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
    });
    if (!buyer) throw new ForbiddenException('User is not a registered buyer');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = { buyerId: buyer.id };
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
    const baseWhere = {
      items: { some: { product: { sellerId: seller.id } } },
    };
    const statusWhere = filter?.status
      ? { ...baseWhere, status: filter.status as OrderStatus }
      : baseWhere;
    let where: Prisma.OrderWhereInput = statusWhere;
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
        ...statusWhere,
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

    const baseWhere = {
      items: { some: { product: { sellerId: seller.id } } },
    };
    const [all, pending, processing, shipped] = await Promise.all([
      this.prisma.order.count({ where: baseWhere }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PENDING },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PAID },
      }),
      this.prisma.order.count({
        where: {
          ...baseWhere,
          status: { in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        },
      }),
    ]);
    return { all, pending, processing, shipped };
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

    return this.prisma.order.update({
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
      order.status !== OrderStatus.PAID
    ) {
      throw new BadRequestException(
        'Only pending or paid orders can be cancelled. Current status: ' +
          order.status,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
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
}
