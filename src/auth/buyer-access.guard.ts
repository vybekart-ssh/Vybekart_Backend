import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Allows buyer cart / orders for:
 * - Role.BUYER, or
 * - a Buyer profile row (JWT user from DB), or
 * - Role.SELLER only (same account using the buyer app — cart is Redis-keyed by userId;
 *   {@link OrdersService.findMyOrders} returns an empty list when there is no Buyer row).
 */
@Injectable()
export class BuyerAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { roles?: Role[]; buyerProfile?: { id: string } | null };
    }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException(
        'You do not have permission to access these resources',
      );
    }
    const roles = user.roles ?? [];
    const allowed =
      roles.includes(Role.BUYER) ||
      roles.includes(Role.SELLER) ||
      user.buyerProfile != null;
    if (allowed) {
      return true;
    }
    throw new ForbiddenException(
      'You do not have permission to access these resources',
    );
  }
}
