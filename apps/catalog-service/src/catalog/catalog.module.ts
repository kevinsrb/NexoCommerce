import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CatalogInternalGuard } from '../common/internal-service.guard';
import { ReservationService } from './reservation.service';
import { ReservationExpiryWorker } from './reservation-expiry.worker';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, PrismaService, CatalogInternalGuard, ReservationService, ReservationExpiryWorker],
})
export class CatalogModule {}
