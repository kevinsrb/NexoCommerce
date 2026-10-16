import { Inject, Injectable } from '@nestjs/common';
import { type OrdersEnvironment } from '@nexo/config';
import { type CartCheckoutSnapshot } from '@nexo/contracts';
import { ORDERS_ENVIRONMENT } from '../common/environment';
import { unavailable } from '../common/checkout-domain.exception';
import { object, privateRequest, quantity, uuid } from '../common/private-http';

@Injectable()
export class CartClient {
  constructor(@Inject(ORDERS_ENVIRONMENT) private readonly env: OrdersEnvironment) {}
  private async call(
    path: string,
    body: unknown,
    requestId: string,
  ): Promise<CartCheckoutSnapshot> {
    const value = object(
      await privateRequest(
        this.env.CART_SERVICE_URL,
        this.env.CART_INTERNAL_SERVICE_TOKEN,
        `/internal/v1/cart/${path}`,
        'POST',
        requestId,
        body,
      ),
    );
    if (
      typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 0 ||
      !Array.isArray(value.lines) ||
      value.lines.length > 100 ||
      !value.lines.every((v) => uuid(object(v).variantId) && quantity(object(v).quantity)) ||
      new Set(value.lines.map((v) => object(v).variantId)).size !== value.lines.length
    )
      throw unavailable();
    return value as unknown as CartCheckoutSnapshot;
  }
  read(principalId: string, requestId: string) {
    return this.call('read', { principalId }, requestId);
  }
  claim(principalId: string, attemptId: string, expectedVersion: number, requestId: string) {
    return this.call('checkout-claims', { principalId, attemptId, expectedVersion }, requestId);
  }
  complete(principalId: string, attemptId: string, version: number, requestId: string) {
    return this.call('checkout-claims/complete', { principalId, attemptId, version }, requestId);
  }
  release(principalId: string, attemptId: string, version: number, requestId: string) {
    return this.call('checkout-claims/release', { principalId, attemptId, version }, requestId);
  }
}
