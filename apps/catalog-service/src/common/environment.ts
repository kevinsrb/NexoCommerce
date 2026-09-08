import { Global, Module } from '@nestjs/common';
import { parseCatalogEnvironment } from '@nexo/config';

export const CATALOG_ENVIRONMENT = Symbol('CATALOG_ENVIRONMENT');

export const parseEnvironment = (input: NodeJS.ProcessEnv) => {
  const environment = parseCatalogEnvironment({ PORT: '3002', ...input });
  if (!['postgres:', 'postgresql:'].includes(new URL(environment.DATABASE_URL).protocol)) {
    throw new Error('Catalog DATABASE_URL must be a PostgreSQL URL');
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
