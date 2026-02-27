import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService) {}

  async findOne(userId: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { userId },
      include: {
        orders: true,
      },
    }); // Profile might be auto-created or checked here

    if (!buyer) throw new NotFoundException('Buyer profile not found');
    return buyer;
  }
}
