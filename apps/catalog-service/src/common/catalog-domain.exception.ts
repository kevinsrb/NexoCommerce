import { HttpException } from '@nestjs/common';

export class CatalogDomainException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: object,
  ) {
    super(message, status);
  }
}
