import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CartClient } from '../cart/cart.client';
import { CatalogClient } from '../catalog/catalog.client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutRecoveryWorker } from './checkout-recovery.worker';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [AuthModule],
  controllers: [CheckoutController],
  providers: [
    PrismaService,
    CartClient,
    CatalogClient,
    CheckoutRepository,
    CheckoutService,
    CheckoutRecoveryWorker,
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
