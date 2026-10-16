import { CheckoutDomainException, unavailable } from './checkout-domain.exception';

const known: Record<string, number> = {
  CART_NOT_FOUND: 404,
  CART_VERSION_CHANGED: 409,
  CART_CHECKOUT_IN_PROGRESS: 409,
  VARIANT_NOT_FOUND: 404,
  VARIANT_UNSELLABLE: 422,
  MIXED_CURRENCY: 422,
  CHECKOUT_PRICE_CHANGED: 409,
  INSUFFICIENT_STOCK: 409,
  RESERVATION_EXPIRED: 409,
  RESERVATION_NOT_FOUND: 404,
  RESERVATION_LINES_MISMATCH: 409,
  RESERVATION_CONFLICT: 409,
};

export async function privateRequest(
  base: string,
  token: string,
  path: string,
  method: string,
  requestId: string,
  body?: unknown,
): Promise<unknown> {
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-token': token,
        'x-request-id': requestId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = object(value);
      if (typeof error.code === 'string' && known[error.code] === response.status) {
        // Only canonical prices are forwarded; never relay arbitrary upstream details.
        const details =
          error.code === 'CHECKOUT_PRICE_CHANGED' &&
          Array.isArray(object(error.details).currentPrices)
            ? {
                currentPrices: (object(error.details).currentPrices as unknown[]).map((v) => {
                  const p = object(v);
                  if (!uuid(p.variantId) || !decimal(p.price_decimal) || !currency(p.currency))
                    throw unavailable();
                  return {
                    variantId: p.variantId,
                    price_decimal: p.price_decimal,
                    currency: p.currency,
                  };
                }),
              }
            : undefined;
        throw new CheckoutDomainException(
          error.code,
          'Checkout could not be completed',
          response.status,
          details,
        );
      }
      throw unavailable();
    }
    return value;
  } catch (error) {
    if (error instanceof CheckoutDomainException) throw error;
    throw unavailable();
  }
}

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const decimal = (v: unknown): v is string =>
  typeof v === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(v);
export const currency = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
export const quantity = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647;
