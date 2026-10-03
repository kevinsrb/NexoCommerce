import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/client';
import { ORDERS_ENVIRONMENT } from '../common/environment';
import { type OrdersEnvironment } from '@nexo/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ORDERS_ENVIRONMENT) environment: OrdersEnvironment) {
    super({ datasources: { db: { url: environment.DATABASE_URL } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
