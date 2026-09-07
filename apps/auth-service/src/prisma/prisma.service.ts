import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/client';
import { AUTH_ENVIRONMENT, type AuthEnvironment } from '../common/environment';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(AUTH_ENVIRONMENT) environment: AuthEnvironment) {
    super({ datasources: { db: { url: environment.DATABASE_URL } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
