import { randomUUID } from 'node:crypto';

import { type NextFunction, type Request, type Response } from 'express';

import { setRequestId } from './request-id.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidRequestId = (value: string | undefined): value is string =>
  value !== undefined && UUID_PATTERN.test(value);

export const requestIdMiddleware = (request: Request, response: Response, next: NextFunction) => {
  const incomingRequestId = request.header('x-request-id');
  const requestId = isValidRequestId(incomingRequestId) ? incomingRequestId : randomUUID();

  setRequestId(request, requestId);
  response.setHeader('x-request-id', requestId);
  next();
};
