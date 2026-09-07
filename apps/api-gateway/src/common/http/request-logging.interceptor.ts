import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { createLogger, withRequestContext } from '@nexo/logger';
import { type Request, type Response } from 'express';
import { catchError, tap, throwError } from 'rxjs';

import { getRequestId } from './request-id.types';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: ReturnType<typeof createLogger>) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = getRequestId(request);
    const requestLogger = requestId ? withRequestContext(this.logger, requestId) : this.logger;
    const logRequest = (level: 'info' | 'error') => {
      requestLogger[level]({
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
      });
    };

    return next.handle().pipe(
      tap(() => logRequest('info')),
      catchError((error: unknown) => {
        logRequest('error');
        return throwError(() => error);
      }),
    );
  }
}
