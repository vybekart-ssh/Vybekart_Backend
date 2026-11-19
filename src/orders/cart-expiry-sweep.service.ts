import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

@Injectable()
export class CartExpirySweepService {
  private readonly logger = new Logger(CartExpirySweepService.name);

  constructor(private readonly orders: OrdersService) {}

  /** Cart expiry removed (B7): sweep is a no-op and never clears carts. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredCarts() {
    try {
      const cleared = await this.orders.sweepAllCarts();
      this.logger.debug(`Hourly cart sweep skipped, cleared=${cleared}`);
    } catch (err) {
      this.logger.error('Hourly cart sweep failed', err);
    }
  }
}
