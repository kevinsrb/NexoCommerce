import { publicGatewayUrl } from './catalog';
import type { CheckoutPriceExpectation } from './cart';

export type CheckoutLineSnapshot = {
  variantId: string;
  quantity: number;
  unit_price_decimal: string;
  line_total_decimal: string;
  currency: string;
};

export type CheckoutResponse = {
  orderId: string;
  state: 'PENDING' | 'EXPIRED';
  currency: string;
  total_decimal: string;
  expiresAt: string;
  publicationRevision: number;
  lines: CheckoutLineSnapshot[];
};

export class CheckoutClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly currentPrices?: CheckoutPriceExpectation[],
  ) {
    super(statusCode === 401 ? 'Sign in to your account, then retry checkout.' : message);
    this.name = 'CheckoutClientError';
  }
}

const price = (value: unknown): value is CheckoutPriceExpectation => {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.variantId === 'string' &&
    typeof candidate.price_decimal === 'string' &&
    typeof candidate.currency === 'string'
  );
};

const currentPrices = (value: unknown): CheckoutPriceExpectation[] | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  const details = value as Record<string, unknown>;
  return Array.isArray(details.currentPrices) && details.currentPrices.every(price)
    ? details.currentPrices
    : undefined;
};

export async function checkout(expectedPrices: CheckoutPriceExpectation[]): Promise<CheckoutResponse> {
  const token = localStorage.getItem('nexo.access-token');
  if (!token) throw new CheckoutClientError(401, 'UNAUTHENTICATED', 'Sign in required');
  if (typeof crypto.randomUUID !== 'function')
    throw new CheckoutClientError(503, 'CHECKOUT_PROCESSING', 'Checkout is not available');

  const response = await fetch(`${publicGatewayUrl()}/checkout`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ expectedPrices }),
  });
  const body: unknown = await response.json();
  if (response.ok && response.status !== 202) return body as CheckoutResponse;

  const error = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  const code = typeof error.code === 'string'
    ? error.code
    : response.status === 202
      ? 'CHECKOUT_PROCESSING'
      : 'CHECKOUT_UNAVAILABLE';
  throw new CheckoutClientError(
    response.status,
    code,
    typeof error.message === 'string' ? error.message : 'Checkout could not be completed',
    typeof error.request_id === 'string'
      ? error.request_id
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
    code === 'CHECKOUT_PRICE_CHANGED' ? currentPrices(error.details) : undefined,
  );
}
