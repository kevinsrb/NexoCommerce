import { createLogger, withRequestContext } from '@nexo/logger';
import { type NextFunction, type Request, type Response } from 'express';

import { getRequestId } from './request-id.types';

export const requestCompletionLoggingMiddleware =
  (logger: ReturnType<typeof createLogger>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const requestId = getRequestId(request);
      const requestLogger = requestId ? withRequestContext(logger, requestId) : logger;
      const duration = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      requestLogger.info({
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        duration,
      });
    });

    next();
  };
