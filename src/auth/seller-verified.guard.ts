import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SKIP_SELLER_VERIFIED_KEY } from './skip-seller-verified.decorator';

@Injectable()
export class SellerVerifiedGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SELLER_VERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; roles?: Role[] } | undefined;
    if (!user?.roles?.includes(Role.SELLER)) {
      return true;
    }

    const seller = await this.prisma.seller.findUnique({
      where: { userId: user.id },
      select: { status: true },
    });
    if (!seller) {
      throw new ForbiddenException('Seller profile not found');
    }
    if (seller.status !== VerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Your seller partner profile is under verification. You will be able to use seller features once VybeKart approves your application.',
      );
    }
    return true;
  }
}
