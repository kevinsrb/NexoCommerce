import { addCartItem, CartClientError, clearCart, loadCart, removeCartItem, updateCartItem } from '../lib/cart';
import { emptyCart, filledCart, gatewayFetch, jsonResponse, updatedCart, variantId } from './cart-fixtures';

describe('Gateway cart client', () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://gateway.example.test/api/';
    localStorage.setItem('nexo.access-token', 'browser-token');
  });
  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('loads the nullable-currency empty cart from the Gateway', async () => {
    global.fetch = gatewayFetch([{ path: '/cart', response: jsonResponse(emptyCart) }]);
    await expect(loadCart()).resolves.toEqual({ currency: null, items: [], total: '0.00', itemCount: 0 });
  });

  it('adds a variant with authenticated JSON and returns the new cart', async () => {
    global.fetch = gatewayFetch([{ path: '/cart/items', method: 'POST', body: { variantId, quantity: 1 }, response: jsonResponse(filledCart, 201) }]);
    await expect(addCartItem(variantId)).resolves.toMatchObject({ itemCount: 1, total: '128.00' });
  });

  it('updates the variant quantity through PATCH', async () => {
    global.fetch = gatewayFetch([{ path: `/cart/items/${variantId}`, method: 'PATCH', body: { quantity: 2 }, response: jsonResponse(updatedCart) }]);
    await expect(updateCartItem(variantId, 2)).resolves.toMatchObject({ itemCount: 2, total: '256.00' });
  });

  it.each(['remove', 'clear'])('accepts the bodyless 204 for %s', async (action) => {
    global.fetch = gatewayFetch([{ path: action === 'remove' ? `/cart/items/${variantId}` : '/cart', method: 'DELETE', response: jsonResponse(undefined, 204) }]);
    await expect(action === 'remove' ? removeCartItem(variantId) : clearCart()).resolves.toBeUndefined();
  });

  it('preserves the typed Gateway error envelope', async () => {
    global.fetch = gatewayFetch([{ path: '/cart/items', method: 'POST', body: { variantId, quantity: 1 }, response: jsonResponse({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', requestId: 'request-123' }, 409) }]);
    const failure = await addCartItem(variantId).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CartClientError);
    expect(failure).toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', requestId: 'request-123' });
  });

  it('requires the established token key instead of sending an anonymous cart request', async () => {
    localStorage.removeItem('nexo.access-token');
    localStorage.setItem('access-token', 'wrong-key');
    global.fetch = async () => { throw new Error('Anonymous cart request sent'); };
    await expect(loadCart()).rejects.toMatchObject({ statusCode: 401, message: expect.stringMatching(/sign in/i) });
  });

  it('turns Gateway 401 into an actionable sign-in error', async () => {
    global.fetch = gatewayFetch([{ path: '/cart', response: jsonResponse({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: 'request-401' }, 401) }]);
    await expect(loadCart()).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message: expect.stringMatching(/sign in/i), requestId: 'request-401' });
  });
});
