import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { StreamsModule } from './streams/streams.module';
import { OrdersModule } from './orders/orders.module';
import { SellersModule } from './sellers/sellers.module';
import { BuyersModule } from './buyers/buyers.module';
import { envValidationSchema } from './env.validation';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { CategoriesModule } from './categories/categories.module';
import { CountriesModule } from './countries/countries.module';
import { LiveKitModule } from './livekit/livekit.module';
import { SupportModule } from './support/support.module';
import { MaterialTypesModule } from './material-types/material-types.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
    }),
    ThrottlerModule.forRoot([
      { ttl: 1000, limit: 30 },
      { ttl: 10000, limit: 100 },
      { ttl: 60000, limit: 300 },
    ]),
    HealthModule,
    RedisModule,
    LiveKitModule,
    PrismaModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    StreamsModule,
    OrdersModule,
    SellersModule,
    BuyersModule,
    CategoriesModule,
    CountriesModule,
    SupportModule,
    MaterialTypesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
