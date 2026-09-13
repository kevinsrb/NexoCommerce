import { resolve } from 'node:path';
import { parseGatewayEnvironment, type GatewayEnvironment } from '@nexo/config';
import { config } from 'dotenv';

const defaultPort = '3003';
type PopulatableEnvironment = Record<string, string>;
export const gatewayEnvironmentPath = resolve(__dirname, '..', '..', '.env');
export const GATEWAY_ENVIRONMENT = Symbol('GATEWAY_ENVIRONMENT');
export type { GatewayEnvironment };

export const parseEnvironment = (input: NodeJS.ProcessEnv) =>
  parseGatewayEnvironment({ PORT: defaultPort, ...input });

export const loadEnvironment = (
  input: PopulatableEnvironment = process.env as PopulatableEnvironment,
  environmentPath = gatewayEnvironmentPath,
) => {
  config({ path: environmentPath, processEnv: input });
  return parseEnvironment(input);
};
