import { resolve } from 'node:path';
import { parseBaseEnvironment } from '@nexo/config';
import { config } from 'dotenv';

const defaultPort = '3003';
type PopulatableEnvironment = Record<string, string>;
export const gatewayEnvironmentPath = resolve(__dirname, '..', '..', '.env');

export const parseEnvironment = (input: NodeJS.ProcessEnv) =>
  parseBaseEnvironment({ PORT: defaultPort, ...input });

export const loadEnvironment = (
  input: PopulatableEnvironment = process.env as PopulatableEnvironment,
  environmentPath = gatewayEnvironmentPath,
) => {
  config({ path: environmentPath, processEnv: input });
  return parseEnvironment(input);
};
