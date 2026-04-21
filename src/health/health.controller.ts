import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
  ) {}

  @Get()
  fast() {
    return { ok: true, timestamp: new Date().toISOString() };
  }

  /**
   * Deeper check (includes DB connectivity). Use for internal monitoring,
   * not keep-alive, since DB ping can be slower and may wake up poolers.
   */
  @Get('db')
  @HealthCheck()
  checkDb() {
    // Terminus Prisma indicator expects a PrismaClient shape which can differ slightly
    // across Prisma versions; cast to keep the health check working across upgrades.
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma as any),
    ]);
  }
}
