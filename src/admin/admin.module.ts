import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
<<<<<<< HEAD
=======
import { SellersModule } from '../sellers/sellers.module';
import { AppConfigModule } from '../app-config/app-config.module';
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
<<<<<<< HEAD
  imports: [PrismaModule],
=======
  imports: [PrismaModule, SellersModule, AppConfigModule],
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
<<<<<<< HEAD

=======
>>>>>>> d6a25c0f08f1171e7dc99d62e6c10bf7d4e6bc48
