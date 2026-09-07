import { type Request } from 'express';

interface RequestWithRequestId extends Request {
  requestId?: string;
}

export const getRequestId = (request: Request): string | undefined =>
  (request as RequestWithRequestId).requestId;

export const setRequestId = (request: Request, requestId: string): void => {
  (request as RequestWithRequestId).requestId = requestId;
};
