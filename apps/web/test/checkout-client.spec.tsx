import { checkout, CheckoutClientError } from '../lib/checkout';
import { jsonResponse, variantId } from './cart-fixtures';

describe('Gateway checkout client', () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  let randomUuid: jest.SpyInstance;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://gateway.example.test/api/';
    localStorage.setItem('nexo.access-token', 'browser-token');
    randomUuid = jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('b63a15d1-c216-44d6-a37a-1a4df8a2eb4d');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    randomUuid.mockRestore();
    localStorage.clear();
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('posts expected prices only to the public Gateway with auth and a per-submit idempotency key', async () => {
    const expectedPrices = [{ variantId, price_decimal: '128.00', currency: 'USD' }];
    const transport = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://gateway.example.test/api/checkout');
      expect(String(input)).not.toContain('CATALOG_' + 'SERVICE_URL');
      expect(init).toMatchObject({ method: 'POST' });
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer browser-token');
      expect(headers.get('Idempotency-Key')).toBe('b63a15d1-c216-44d6-a37a-1a4df8a2eb4d');
      expect(JSON.parse(init?.body as string)).toEqual({ expectedPrices });
      return jsonResponse({
        orderId: '500c6fcc-154a-4ec3-8a07-5e02b3f04bf4',
        state: 'PENDING',
        currency: 'USD',
        total_decimal: '128.00',
        expiresAt: '2026-10-15T12:15:00.000Z',
        publicationRevision: 1,
        lines: [],
      }, 201);
    });
    global.fetch = transport as typeof fetch;

    await expect(checkout(expectedPrices)).resolves.toMatchObject({ state: 'PENDING' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(randomUuid).toHaveBeenCalledTimes(1);
  });

  it('exposes canonical prices from a checkout reconfirmation response', async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      code: 'CHECKOUT_PRICE_CHANGED',
      message: 'Price changed',
      request_id: 'checkout-price-change',
      details: { currentPrices: [{ variantId, price_decimal: '130.00', currency: 'USD' }] },
    }, 409)) as typeof fetch;

    const failure = await checkout([{ variantId, price_decimal: '128.00', currency: 'USD' }])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CheckoutClientError);
    expect(failure).toMatchObject({
      statusCode: 409,
      code: 'CHECKOUT_PRICE_CHANGED',
      currentPrices: [{ variantId, price_decimal: '130.00', currency: 'USD' }],
    });
  });
});
