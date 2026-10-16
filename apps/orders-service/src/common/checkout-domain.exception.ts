import { HttpException } from '@nestjs/common';

export class CheckoutDomainException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}

export const unavailable = () =>
  new CheckoutDomainException('DEPENDENCY_UNAVAILABLE', 'Checkout dependency unavailable', 503);
