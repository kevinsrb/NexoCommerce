import { Inject, Injectable } from '@nestjs/common';
import { type OrdersEnvironment } from '@nexo/config';
import {
  type CatalogReservation,
  type CatalogReservationLine,
  type CheckoutCatalogVariant,
} from '@nexo/contracts';
import { ORDERS_ENVIRONMENT } from '../common/environment';
import { unavailable } from '../common/checkout-domain.exception';
import { currency, decimal, object, privateRequest, quantity, uuid } from '../common/private-http';

@Injectable()
export class CatalogClient {
  constructor(@Inject(ORDERS_ENVIRONMENT) private readonly env: OrdersEnvironment) {}
  private call(path: string, method: string, requestId: string, body?: unknown) {
    return privateRequest(
      this.env.CATALOG_SERVICE_URL,
      this.env.CATALOG_INTERNAL_TOKEN,
      `/internal/v1/${path}`,
      method,
      requestId,
      body,
    );
  }
  async variant(id: string, requestId: string): Promise<CheckoutCatalogVariant> {
    const value = object(await this.call(`variants/${id}`, 'GET', requestId));
    if (
      value.variantId !== id ||
      typeof value.sellable !== 'boolean' ||
      typeof value.available !== 'number' ||
      !Number.isSafeInteger(value.available) ||
      value.available < 0 ||
      !decimal(value.price_decimal) ||
      !currency(value.currency)
    )
      throw unavailable();
    return value as unknown as CheckoutCatalogVariant;
  }
  private async reservation(
    path: string,
    method: string,
    attemptId: string,
    requestId: string,
    body?: unknown,
  ): Promise<CatalogReservation> {
    const v = object(await this.call(path, method, requestId, body));
    if (
      !uuid(v.reservationId) ||
      v.attemptId !== attemptId ||
      !['ACTIVE', 'PUBLISHED', 'EXPIRED', 'RELEASED'].includes(v.state as string) ||
      typeof v.reservedAt !== 'string' ||
      !Number.isFinite(Date.parse(v.reservedAt)) ||
      typeof v.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(v.expiresAt)) ||
      Date.parse(v.expiresAt) - Date.parse(v.reservedAt) !== 900000 ||
      !(v.boundOrderId === null || uuid(v.boundOrderId)) ||
      !(
        v.publicationRevision === null ||
        (typeof v.publicationRevision === 'number' &&
          Number.isSafeInteger(v.publicationRevision) &&
          v.publicationRevision > 0)
      ) ||
      (v.state === 'PUBLISHED' && (!v.boundOrderId || !v.publicationRevision)) ||
      !Array.isArray(v.lines) ||
      !v.lines.length ||
      v.lines.length > 100 ||
      !v.lines.every((line) => {
        const l = object(line);
        return (
          uuid(l.variantId) &&
          quantity(l.quantity) &&
          decimal(l.unit_price_decimal) &&
          currency(l.currency)
        );
      }) ||
      new Set(v.lines.map((line) => object(line).variantId)).size !== v.lines.length
    )
      throw unavailable();
    return v as unknown as CatalogReservation;
  }
  reserve(attemptId: string, lines: CatalogReservationLine[], requestId: string) {
    return this.reservation('reservations', 'POST', attemptId, requestId, { attemptId, lines });
  }
  status(attemptId: string, requestId: string) {
    return this.reservation(`reservations/by-attempt/${attemptId}`, 'GET', attemptId, requestId);
  }
  publish(attemptId: string, orderId: string, requestId: string) {
    return this.reservation(
      `reservations/by-attempt/${attemptId}/publish-order`,
      'POST',
      attemptId,
      requestId,
      { orderId },
    );
  }
  release(attemptId: string, requestId: string) {
    return this.reservation(`reservations/by-attempt/${attemptId}`, 'DELETE', attemptId, requestId);
  }
}
