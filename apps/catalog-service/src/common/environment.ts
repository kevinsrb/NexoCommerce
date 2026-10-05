import { Global, Module } from '@nestjs/common';
import { parseCatalogEnvironment } from '@nexo/config';

export const CATALOG_ENVIRONMENT = Symbol('CATALOG_ENVIRONMENT');

export const parseEnvironment = (input: NodeJS.ProcessEnv) => {
  const environment = parseCatalogEnvironment({ PORT: '3002', ...input });
  if (!['postgres:', 'postgresql:'].includes(new URL(environment.DATABASE_URL).protocol)) {
    throw new Error('Catalog DATABASE_URL must be a PostgreSQL URL');
  }
  if (
    environment.CATALOG_ADMIN_SECRET === environment.JWT_ACCESS_SECRET ||
    environment.CATALOG_ADMIN_SECRET === environment.CATALOG_INTERNAL_TOKEN ||
    environment.CATALOG_INTERNAL_TOKEN === environment.JWT_ACCESS_SECRET
  ) {
    throw new Error('Catalog service secrets must be distinct');
  }
  return environment;
};
export type CatalogEnvironment = ReturnType<typeof parseEnvironment>;

@Global()
@Module({
  providers: [{ provide: CATALOG_ENVIRONMENT, useFactory: () => parseEnvironment(process.env) }],
  exports: [CATALOG_ENVIRONMENT],
})
export class EnvironmentModule {}
