import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SellerOrdersQueryDto } from './dto/seller-orders-query.dto';

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

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  findMyOrders(
    @Request() req: { user: { id: string } },
    @Query() query: PaginationQueryDto,
  ) {
    return this.ordersService.findMyOrders(req.user.id, query);
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
