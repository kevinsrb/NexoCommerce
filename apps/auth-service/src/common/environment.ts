import { Global, Module } from '@nestjs/common';
import { parseAuthEnvironment } from '@nexo/config';

export const AUTH_ENVIRONMENT = Symbol('AUTH_ENVIRONMENT');

const ttl = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 31_536_000
  ) {
    throw new Error('JWT TTL must be a positive integer number of seconds, at most one year');
  }
  return Number(value);
};

export const parseEnvironment = (input: NodeJS.ProcessEnv) => {
  const environment = parseAuthEnvironment({ PORT: '3001', ...input });
  if (!['postgres:', 'postgresql:'].includes(new URL(environment.DATABASE_URL).protocol)) {
    throw new Error('Auth DATABASE_URL must be a PostgreSQL URL');
  }
  if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_SECRET) {
    throw new Error('Access and refresh JWT secrets must differ');
  }
  return {
    ...environment,
    JWT_ACCESS_TTL_SECONDS: ttl(input.JWT_ACCESS_TTL_SECONDS, 900),
    JWT_REFRESH_TTL_SECONDS: ttl(input.JWT_REFRESH_TTL_SECONDS, 604800),
  };
};
export type AuthEnvironment = ReturnType<typeof parseEnvironment>;

@Global()
@Module({
  providers: [{ provide: AUTH_ENVIRONMENT, useFactory: () => parseEnvironment(process.env) }],
  exports: [AUTH_ENVIRONMENT],
})
export class EnvironmentModule {}
