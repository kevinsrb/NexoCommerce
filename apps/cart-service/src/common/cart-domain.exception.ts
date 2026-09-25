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

export class CartStorageUnavailableException extends CartDomainException {
  constructor() {
    super('CART_STORAGE_UNAVAILABLE', 'Cart storage unavailable', 503);
  }
}
