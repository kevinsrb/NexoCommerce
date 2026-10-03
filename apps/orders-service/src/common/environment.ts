import { Global, Module } from '@nestjs/common';
import { parseOrdersEnvironment, type OrdersEnvironment } from '@nexo/config';

export const ORDERS_ENVIRONMENT = Symbol('ORDERS_ENVIRONMENT');

export const parseEnvironment = (input: NodeJS.ProcessEnv): OrdersEnvironment => {
  const environment = parseOrdersEnvironment({ PORT: '3005', ...input });
  if (!['postgres:', 'postgresql:'].includes(new URL(environment.DATABASE_URL).protocol)) {
    throw new Error('Orders DATABASE_URL must be a PostgreSQL URL');
  }
  return environment;
};

@Global()
@Module({
  providers: [{ provide: ORDERS_ENVIRONMENT, useFactory: () => parseEnvironment(process.env) }],
  exports: [ORDERS_ENVIRONMENT],
})
export class EnvironmentModule {}
