import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';
import { CartItemDto, UpdateCartQuantityDto } from './dto/cart-item.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';
import { BuyerOrdersQueryDto } from './dto/buyer-orders-query.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  create(
    @Request() req: { user: { id: string } },
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.create(createOrderDto, req.user.id);
  }

  @Get('cart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  getCart(@Request() req: { user: { id: string } }) {
    return this.ordersService.getCart(req.user.id);
  }

  @Post('cart/items')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  addCartItem(
    @Request() req: { user: { id: string } },
    @Body() dto: CartItemDto,
  ) {
    return this.ordersService.addCartItem(req.user.id, dto);
  }

  @Patch('cart/items/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  updateCartItem(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
    @Body() dto: UpdateCartQuantityDto,
  ) {
    return this.ordersService.updateCartItem(req.user.id, productId, dto.quantity);
  }

  @Patch('checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  checkout(
    @Request() req: { user: { id: string } },
    @Body() dto: CheckoutOrderDto,
  ) {
    return this.ordersService.checkoutFromCart(req.user.id, dto);
  }

  @Delete('cart/items/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  removeCartItem(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
  ) {
    return this.ordersService.removeCartItem(req.user.id, productId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  findMyOrders(
    @Request() req: { user: { id: string } },
    @Query() query: BuyerOrdersQueryDto,
  ) {
    return this.ordersService.findMyOrders(req.user.id, query);
  }

  @Get(':id/help')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  getOrderHelp(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderHelp(id, req.user.id);
  }

  @Get('seller')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  findSellerOrders(
    @Request() req: { user: { id: string } },
    @Query() query: SellerOrdersQueryDto,
  ) {
    const pagination = { page: query.page, limit: query.limit };
    return this.ordersService.findSellerOrders(req.user.id, pagination, query);
  }

  @Get('seller/counts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  getSellerOrderCounts(@Request() req: { user: { id: string } }) {
    return this.ordersService.getSellerOrderCounts(req.user.id);
  }

  @Patch(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  acceptOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.acceptOrder(id, req.user.id);
  }

  @Post(':id/packing-video')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 80 * 1024 * 1024 } }))
  uploadPackingVideo(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ordersService.uploadPackingVideo(id, req.user.id, file);
  }

  @Patch(':id/request-delivery')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  requestDelivery(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.requestDeliveryFromPartner(id, req.user.id);
  }

  @Get(':id/delivery-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  getDeliveryStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrderDeliveryStatus(id, req.user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Request() req: { user: { id: string } }, @Param('id') id: string) {
    return this.ordersService.findOne(id, req.user.id);
  }

  @Patch(':id/ship')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  shipOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: ShipOrderDto,
  ) {
    return this.ordersService.shipOrder(id, req.user.id, dto);
  }

  @Patch(':id/deliver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  deliverOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.deliverOrder(id, req.user.id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  cancelOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.cancelOrder(id, req.user.id);
  }

  @Patch(':id/return')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  returnOrder(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.ordersService.returnOrder(id, req.user.id);
  }
}
