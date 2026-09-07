import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

export const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(3000),
});

export const authEnvironmentSchema = baseEnvironmentSchema.extend({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
});

export const catalogEnvironmentSchema = baseEnvironmentSchema.extend({
  DATABASE_URL: z.string().url(),
});

export const parseBaseEnvironment = (environment: NodeJS.ProcessEnv) =>
  baseEnvironmentSchema.parse(environment);
export const parseAuthEnvironment = (environment: NodeJS.ProcessEnv) =>
  authEnvironmentSchema.parse(environment);
export const parseCatalogEnvironment = (environment: NodeJS.ProcessEnv) =>
  catalogEnvironmentSchema.parse(environment);
