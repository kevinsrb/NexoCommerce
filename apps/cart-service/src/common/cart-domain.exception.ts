import { HttpException } from '@nestjs/common';

export class CartDomainException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    statusCode: number,
  ) {
    super(message, statusCode);
  }
}
