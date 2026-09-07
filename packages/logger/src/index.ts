import pino, { type Logger, type LoggerOptions } from 'pino';

export interface LoggerContext {
  service: string;
  requestId?: string;
}

export const createLogger = (service: string, options: LoggerOptions = {}): Logger =>
  pino({ base: { service }, ...options });

export const withRequestContext = (logger: Logger, requestId: string): Logger =>
  logger.child({ requestId });
