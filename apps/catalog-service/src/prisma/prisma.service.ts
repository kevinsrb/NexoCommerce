import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/client';
import { CATALOG_ENVIRONMENT, type CatalogEnvironment } from '../common/environment';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(CATALOG_ENVIRONMENT) environment: CatalogEnvironment) {
    super({ datasources: { db: { url: environment.DATABASE_URL } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
