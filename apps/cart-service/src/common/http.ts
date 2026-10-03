import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  ValidationPipe,
} from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type ApiError } from '@nexo/contracts';
import { createLogger, withRequestContext } from '@nexo/logger';
import { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { CartDomainException, CartStorageUnavailableException } from './cart-domain.exception';

const logger = createLogger('cart-service');
type ContextRequest = Request & { requestId?: string };

@Catch()
class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ContextRequest>();
    const response = context.getResponse<Response>();
    const statusCode = error instanceof HttpException ? error.getStatus() : 500;
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
    };
    const body: ApiError = {
      statusCode,
      code:
        error instanceof CartDomainException
          ? error.code
          : (codes[statusCode] ?? 'INTERNAL_SERVER_ERROR'),
      message:
        error instanceof CartDomainException
          ? error.message
          : statusCode >= 500
            ? 'Internal server error'
            : error instanceof HttpException
              ? error.message
              : 'Internal server error',
      requestId: request.requestId ?? 'unknown',
    };
    if (error instanceof CartStorageUnavailableException) {
      logger.error(
        { event: 'cart_storage_unavailable', requestId: body.requestId },
        'Cart storage unavailable',
      );
    }
    if (request.path.startsWith('/internal/v1/cart/')) {
      response.status(statusCode).json({
        code: error instanceof CartStorageUnavailableException ? 'DEPENDENCY_UNAVAILABLE'
          : error instanceof CartDomainException ? error.code
            : statusCode === 400 ? 'INVALID_REQUEST'
              : statusCode === 401 ? 'UNAUTHENTICATED'
                : body.code,
        message: body.message,
        request_id: body.requestId,
      });
      return;
    }
    response.status(statusCode).json(body);
  }
}

export const configureHttpApp = (app: NestExpressApplication): void => {
  app.use((request: ContextRequest, response: Response, next: NextFunction) => {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming)
        ? incoming
        : randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    const start = process.hrtime.bigint();
    response.once('finish', () =>
      withRequestContext(logger, requestId).info({
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        duration: Number(process.hrtime.bigint() - start) / 1_000_000,
      }),
    );
    next();
  });
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
};
