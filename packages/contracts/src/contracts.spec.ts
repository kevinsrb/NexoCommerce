import { ApiError, type CheckoutPriceExpectation, type CheckoutResponse, type OrderState } from './index';

describe('ApiError', () => {
  it('constructs a typed public API error', () => {
    const error: ApiError = {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'request-123',
    };

    expect(error).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'request-123',
    });
  });
});

describe('checkout contracts', () => {
  it('keeps expected and snapshot prices as decimal strings', () => {
    const expectation: CheckoutPriceExpectation = { variantId: 'variant-1', price_decimal: '1234567890123456.78', currency: 'COP' };
    const response: CheckoutResponse = {
      orderId: 'order-1', state: 'PENDING', currency: 'COP', total_decimal: '2469135780246913.56',
      expiresAt: '2026-10-02T12:15:00.000Z', publicationRevision: 1,
      lines: [{ variantId: expectation.variantId, quantity: 2, unit_price_decimal: expectation.price_decimal, line_total_decimal: '2469135780246913.56', currency: 'COP' }],
    };
    expect(response.lines[0].unit_price_decimal).toBe(expectation.price_decimal);
    expect(typeof response.total_decimal).toBe('string');
  });

  it('exposes only pending and expired order states', () => {
    const states: OrderState[] = ['PENDING', 'EXPIRED'];
    // @ts-expect-error Internal recording state is never public.
    const internal: OrderState = 'RECORDING';
    void internal;
    expect(states).toEqual(['PENDING', 'EXPIRED']);
  });
});
