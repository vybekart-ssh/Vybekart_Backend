import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ProductStatus, Prisma } from '@prisma/client';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationQueryDto,
  PaginatedResult,
} from '../common/dto/pagination-query.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto, sellerId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId: sellerId },
    });

    if (!seller) {
      throw new ForbiddenException('User is not a registered seller');
    }

    const { variants, ...rest } = createProductDto;
    return this.prisma.product.create({
      data: {
        ...rest,
        sellerId: seller.id,
        ...(variants != null && { variants: variants as Prisma.InputJsonValue }),
      },
    });
  }

  async findAll(query: PaginationQueryDto): Promise<PaginatedResult<unknown>> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        include: { seller: { select: { businessName: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count(),
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

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Check ownership
    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only update your own products');
    }

    const dto = updateProductDto as UpdateProductDto & { variants?: Record<string, unknown> };
    const { variants, ...rest } = dto;
    return this.prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(variants !== undefined && { variants: variants as Prisma.InputJsonValue }),
      },
    });
  }

  async remove(id: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { seller: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    if (product.seller.userId !== userId) {
      throw new ForbiddenException('You can only delete your own products');
    }

    return this.prisma.product.delete({ where: { id } });
  }

  async findMyProducts(
    userId: string,
    query: PaginationQueryDto,
    filter?: MyListingsQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const page = Math.max(1, parseInt(String(query?.page ?? 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(query?.limit ?? 20), 10) || 20));
    const skip = (page - 1) * limit;
    const baseWhere: {
      seller: { userId: string };
      name?: { contains: string; mode: 'insensitive' };
      stock?: number | { gt: number };
      status?: ProductStatus;
    } = { seller: { userId } };
    if (filter?.search?.trim()) {
      baseWhere.name = { contains: filter.search.trim(), mode: 'insensitive' };
    }
    if (filter?.status === 'active') baseWhere.stock = { gt: 0 };
    if (filter?.status === 'out_of_stock') baseWhere.stock = 0;
    if (filter?.status === 'draft') baseWhere.status = ProductStatus.DRAFT;
    const where = baseWhere;
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
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
}
