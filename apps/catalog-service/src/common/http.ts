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
import { Prisma } from '../../generated/client';

const logger = createLogger('catalog-service');
type ContextRequest = Request & { requestId?: string };

@Catch()
class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<ContextRequest>();
    const response = context.getResponse<Response>();
    const databaseError =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? { P2002: 409, P2003: 400, P2025: 404 }[error.code]
        : undefined;
    const statusCode = databaseError ?? (error instanceof HttpException ? error.getStatus() : 500);
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
      code: codes[statusCode] ?? 'INTERNAL_SERVER_ERROR',
      message:
        statusCode >= 500
          ? 'Internal server error'
          : statusCode === 400
            ? 'Bad request'
            : databaseError
              ? statusCode === 409
                ? 'Resource already exists'
                : 'Resource not found'
              : error instanceof HttpException
                ? error.message
                : 'Request failed',
      requestId: request.requestId ?? 'unknown',
    };
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
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
};
