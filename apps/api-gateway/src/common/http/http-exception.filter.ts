import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { type ApiError } from '@nexo/contracts';
import { type Request, type Response } from 'express';

import { getRequestId } from './request-id.types';

const statusCodeToErrorCode = (statusCode: number): string => {
  const errorCodes: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
  };

  return errorCodes[statusCode] ?? 'INTERNAL_SERVER_ERROR';
};

const hasMessage = (response: object): response is { message?: string | string[] } =>
  'message' in response;

const exceptionMessage = (exception: HttpException): string => {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }

  const message = hasMessage(response) ? response.message : undefined;
  return Array.isArray(message) ? message.join(', ') : (message ?? exception.message);
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ApiError = {
      statusCode,
      code: statusCodeToErrorCode(statusCode),
      message:
        statusCode === HttpStatus.BAD_REQUEST
          ? 'Bad request'
          : exception instanceof HttpException
            ? exceptionMessage(exception)
            : 'Internal server error',
      requestId: getRequestId(request) ?? 'unknown',
    };

    response.status(statusCode).json(body);
  }
}
