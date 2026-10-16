import { Injectable } from '@nestjs/common';
import {
  type CatalogReservation,
  type CatalogReservationLine,
  type CheckoutLineSnapshot,
  type CheckoutPriceExpectation,
  type CheckoutProcessingResponse,
  type CheckoutRequest,
  type CheckoutResponse,
  type CartCheckoutSnapshot,
} from '@nexo/contracts';
import { CartClient } from '../cart/cart.client';
import { CatalogClient } from '../catalog/catalog.client';
import { CheckoutDomainException, unavailable } from '../common/checkout-domain.exception';
import { Attempt, CheckoutRepository, json, LeaseLostError } from './checkout.repository';

type Result = { status: number; body: CheckoutResponse | CheckoutProcessingResponse };
type Failure = { code: string; message: string; status: number; details?: Record<string, unknown> };
const fail = (code: string, status: number, details?: Record<string, unknown>) =>
  new CheckoutDomainException(code, 'Checkout could not be completed', status, details);
const minor = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(2, '0'));
};
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly repository: CheckoutRepository,
    private readonly cart: CartClient,
    private readonly catalog: CatalogClient,
  ) {}

  async checkout(
    principalId: string,
    key: string,
    input: CheckoutRequest,
    requestId: string,
  ): Promise<Result> {
    const attempt = await this.repository.claim(principalId, key, input.expectedPrices, requestId);
    return this.resume(attempt.id, requestId);
  }

  async resume(id: string, requestId: string): Promise<Result> {
    let attempt = await this.repository.acquire(id);
    const processing = (): Result => ({
      status: 202,
      body: {
        code: 'CHECKOUT_PROCESSING',
        message: 'Checkout is processing',
        request_id: requestId,
      },
    });
    if (!attempt) return processing();
    let newlyPublished = false;
    try {
      if (attempt.failure) {
        if (attempt.state !== 'FAILED') attempt = await this.finishFailure(attempt, requestId);
        const failure = attempt.failure as unknown as Failure;
        throw new CheckoutDomainException(
          failure.code,
          failure.message,
          failure.status,
          failure.details,
        );
      }
      if (attempt.state === 'CLAIMED') {
        if (attempt.cartVersion === null) {
          const snapshot = await this.cart.read(attempt.principalId, requestId);
          if (!snapshot.lines.length) throw fail('CART_EMPTY', 422);
          attempt = await this.repository.save(attempt, {
            cartVersion: BigInt(snapshot.version),
            cartLines: json(snapshot.lines),
          });
        }
        const claim = await this.cart.claim(
          attempt.principalId,
          attempt.id,
          Number(attempt.cartVersion),
          requestId,
        );
        if (claim.version !== Number(attempt.cartVersion) || !claim.lines.length)
          throw unavailable();
        attempt = await this.repository.save(attempt, {
          cartClaimRef: attempt.id,
          cartLines: json(claim.lines),
          state: 'CART_CLAIMED',
        });
      }
      if (attempt.state === 'CART_CLAIMED') {
        const lines = attempt.cartLines as unknown as CartCheckoutSnapshot['lines'];
        const expected = attempt.expectedPrices as unknown as CheckoutPriceExpectation[];
        if (
          lines.length !== expected.length ||
          lines.some((line) => !expected.some((p) => p.variantId === line.variantId))
        )
          throw fail('INVALID_REQUEST', 400);
        const variants = await Promise.all(
          lines.map((line) => this.catalog.variant(line.variantId, requestId)),
        );
        if (variants.some((v) => !v.sellable)) throw fail('VARIANT_UNSELLABLE', 422);
        if (new Set(variants.map((v) => v.currency)).size !== 1) throw fail('MIXED_CURRENCY', 422);
        if (
          variants.some((v) => {
            const price = expected.find((p) => p.variantId === v.variantId)!;
            return (
              minor(price.price_decimal) !== minor(v.price_decimal) || price.currency !== v.currency
            );
          })
        )
          throw fail('CHECKOUT_PRICE_CHANGED', 409, {
            currentPrices: variants.map(({ variantId, price_decimal, currency }) => ({
              variantId,
              price_decimal,
              currency,
            })),
          });
        const prepared = lines
          .map((line) => {
            const v = variants.find((v) => v.variantId === line.variantId)!;
            return {
              ...line,
              expected_price_decimal: v.price_decimal,
              expected_currency: v.currency,
            };
          })
          .sort((a, b) => a.variantId.localeCompare(b.variantId));
        attempt = await this.repository.save(attempt, {
          preparedLines: json(prepared),
          state: 'PREPARED',
        });
      }
      if (attempt.state === 'PREPARED')
        attempt = await this.repository.save(attempt, { state: 'RESERVATION_PENDING' });
      if (attempt.state === 'RESERVATION_PENDING') {
        const reservation = await this.catalog.reserve(
          attempt.id,
          attempt.preparedLines as unknown as CatalogReservationLine[],
          requestId,
        );
        this.validateReservation(attempt, reservation);
        const lines = reservation.lines.map((line) => ({
          ...line,
          line_total_decimal: money(minor(line.unit_price_decimal) * BigInt(line.quantity)),
        }));
        const total = money(lines.reduce((sum, line) => sum + minor(line.line_total_decimal), 0n));
        attempt = await this.repository.recordOrder(attempt, reservation, total, lines);
      }
      if (!attempt.order) throw unavailable();
      // Every replay reads Catalog. A cached success is never evidence of current PENDING.
      let reservation = await this.catalog.status(attempt.id, requestId);
      this.validateReservation(attempt, reservation);
      if (reservation.state === 'ACTIVE') {
        try {
          reservation = await this.catalog.publish(attempt.id, attempt.order.id, requestId);
        } catch (error) {
          if (!(error instanceof CheckoutDomainException) || error.code !== 'RESERVATION_EXPIRED')
            throw error;
          reservation = await this.catalog.status(attempt.id, requestId);
        }
      }
      this.validateReservation(attempt, reservation);
      if (reservation.state === 'ACTIVE') throw unavailable();
      const published =
        reservation.publicationRevision !== null && reservation.boundOrderId === attempt.order.id;
      if (
        (reservation.state === 'PUBLISHED' && !published) ||
        (reservation.boundOrderId !== null && reservation.boundOrderId !== attempt.order.id) ||
        (attempt.order.catalogPublicationRevision !== null &&
          BigInt(reservation.publicationRevision ?? 0) !== attempt.order.catalogPublicationRevision)
      )
        throw unavailable();
      newlyPublished = attempt.order.state === 'RECORDING' && reservation.state === 'PUBLISHED';
      attempt = await this.repository.lifecycle(attempt, reservation);
      if (!published) throw fail('RESERVATION_EXPIRED', 409);
      // Publication is durable. A finalization outage must not hide an accepted order.
      try {
        await this.cart.complete(
          attempt.principalId,
          attempt.id,
          Number(attempt.cartVersion),
          requestId,
        );
        attempt = await this.repository.save(attempt, {
          state: 'COMPLETE',
          recoverAfter: new Date(Date.now() + 5000),
        });
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
      }
      return { status: newlyPublished ? 201 : 200, body: this.present(attempt) };
    } catch (error) {
      if (error instanceof CheckoutDomainException && error.getStatus() < 500) {
        if (!attempt.failure) {
          const code = error.code === 'CART_NOT_FOUND' ? 'CART_EMPTY' : error.code;
          const failure: Failure = {
            code,
            status: code === 'CART_EMPTY' ? 422 : error.getStatus(),
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          };
          attempt = await this.repository.save(attempt, {
            failureCode: code,
            failure: json(failure),
          });
        }
        try {
          if (attempt.state !== 'FAILED') attempt = await this.finishFailure(attempt, requestId);
        } catch {
          return processing();
        }
        const failure = attempt.failure as unknown as Failure;
        throw new CheckoutDomainException(
          failure.code,
          failure.message,
          failure.status,
          failure.details,
        );
      }
      return processing();
    } finally {
      await this.repository.release(attempt);
    }
  }

  private validateReservation(attempt: Attempt, reservation: CatalogReservation) {
    const lines = attempt.preparedLines as unknown as CatalogReservationLine[];
    if (
      reservation.lines.length !== lines.length ||
      reservation.lines.some((line) => {
        const expected = lines.find((p) => p.variantId === line.variantId);
        return (
          !expected ||
          expected.quantity !== line.quantity ||
          expected.expected_currency !== line.currency ||
          minor(expected.expected_price_decimal) !== minor(line.unit_price_decimal)
        );
      })
    )
      throw unavailable();
    if (attempt.reservationRef && attempt.reservationRef !== reservation.reservationId)
      throw unavailable();
  }

  private async finishFailure(attempt: Attempt, requestId: string): Promise<Attempt> {
    if (attempt.preparedLines && !['CLAIMED', 'CART_CLAIMED', 'PREPARED'].includes(attempt.state)) {
      try {
        let reservation = await this.catalog.status(attempt.id, requestId);
        if (reservation.state === 'ACTIVE' || reservation.state === 'PUBLISHED')
          reservation = await this.catalog.release(attempt.id, requestId);
        if (reservation.state !== 'EXPIRED' && reservation.state !== 'RELEASED')
          throw unavailable();
        if (attempt.order && attempt.order.state !== 'EXPIRED')
          attempt = await this.repository.lifecycle(attempt, reservation);
      } catch (error) {
        if (!(error instanceof CheckoutDomainException) || error.code !== 'RESERVATION_NOT_FOUND')
          throw error;
      }
    }
    if (attempt.cartClaimRef)
      await this.cart.release(
        attempt.principalId,
        attempt.id,
        Number(attempt.cartVersion),
        requestId,
      );
    return this.repository.save(attempt, { state: 'FAILED' });
  }

  private present(attempt: Attempt): CheckoutResponse {
    const order = attempt.order!;
    if (
      (order.state !== 'PENDING' && order.state !== 'EXPIRED') ||
      order.catalogPublicationRevision === null
    )
      throw unavailable();
    return {
      orderId: order.id,
      state: order.state,
      currency: order.currency,
      total_decimal: order.totalDecimal,
      expiresAt: order.expiresAt.toISOString(),
      publicationRevision: Number(order.catalogPublicationRevision),
      lines: order.lines.map(
        (line): CheckoutLineSnapshot => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unit_price_decimal: line.unitPriceDecimal,
          line_total_decimal: line.lineTotalDecimal,
          currency: line.currency,
        }),
      ),
    };
  }
}
