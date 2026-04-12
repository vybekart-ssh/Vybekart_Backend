import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Allows buyer cart / orders when the user has Role.BUYER **or** a Buyer profile row.
 * {@link JwtStrategy} loads `buyerProfile` on `request.user`; some accounts can have a
 * profile without BUYER in `roles` (legacy / data drift). `/buyers/*` only uses JwtAuthGuard,
 * so those routes worked while `/orders/*` returned 403 from RolesGuard.
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
    const hasBuyerRole = user.roles?.some((r) => r === Role.BUYER) ?? false;
    const hasBuyerProfile = user.buyerProfile != null;
    if (hasBuyerRole || hasBuyerProfile) {
      return true;
    }
    throw new ForbiddenException(
      'You do not have permission to access these resources',
    );
  }
}
