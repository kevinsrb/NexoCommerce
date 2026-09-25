import { Global, Module } from '@nestjs/common';
import { parseCartEnvironment } from '@nexo/config';

export const CART_ENVIRONMENT = Symbol('CART_ENVIRONMENT');

export const parseEnvironment = (input: NodeJS.ProcessEnv) => {
  const environment = parseCartEnvironment({ PORT: '3004', ...input });
  if (!['redis:', 'rediss:'].includes(new URL(environment.REDIS_URL).protocol)) {
    throw new Error('Cart REDIS_URL must be a Redis URL');
  }
  if (!['http:', 'https:'].includes(new URL(environment.CATALOG_SERVICE_URL).protocol)) {
    throw new Error('Cart CATALOG_SERVICE_URL must be an HTTP URL');
  }
  if (environment.CATALOG_INTERNAL_TOKEN === environment.JWT_ACCESS_SECRET) {
    throw new Error('Catalog service token must differ from the Cart JWT secret');
  }
  return environment;
};
export type CartEnvironment = ReturnType<typeof parseEnvironment>;

@Global()
@Module({
  providers: [{ provide: CART_ENVIRONMENT, useFactory: () => parseEnvironment(process.env) }],
  exports: [CART_ENVIRONMENT],
})
export class EnvironmentModule {}
