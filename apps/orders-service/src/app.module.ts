import { Module } from '@nestjs/common';
import { CheckoutModule } from './checkout/checkout.module';
import { EnvironmentModule } from './common/environment';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [EnvironmentModule, CheckoutModule],
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
