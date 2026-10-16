import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CartRoute from '../app/cart/page';
import { CartProvider } from '../components/cart-provider';
import { ProductGrid } from '../components/product-grid';
import { emptyCart, filledCart, gatewayFetch, jsonResponse, updatedCart, variantId } from './cart-fixtures';

const product = { id: filledCart.items[0].productId, variantId, name: 'Gateway Lamp', description: 'A warm light.', price: '$128.00', category: 'Lighting', accent: 'from-amber-200/70 to-orange-500/20' };

function renderCart(withProduct = false) {
  return render(<CartProvider><CartRoute />{withProduct && <ProductGrid products={[product]} />}</CartProvider>);
}

describe('Storefront cart flow', () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://gateway.example.test/api';
    localStorage.setItem('nexo.access-token', 'browser-token');
  });
  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('shows loading before the provider initial GET resolves to an empty cart', async () => {
    let resolve!: (response: Response) => void;
    global.fetch = gatewayFetch([{ path: '/cart', response: new Promise<Response>((done) => { resolve = done; }) }]);
    renderCart();
    expect(screen.getByRole('status')).toHaveTextContent(/loading.*cart/i);
    await act(async () => resolve(jsonResponse(emptyCart)));
    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue shopping/i })).toHaveAttribute('href', '/#products');
    expect(screen.getByRole('link', { name: /cart.*0/i })).toHaveAttribute('href', '/cart');
  });

  it('renders server line amounts and navigation quantity', async () => {
    global.fetch = gatewayFetch([{ path: '/cart', response: jsonResponse(updatedCart) }]);
    renderCart();
    expect(await screen.findByRole('heading', { name: 'Gateway Lamp' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /quantity.*Gateway Lamp/i })).toHaveValue(2);
    expect(screen.getByRole('link', { name: /cart.*2/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('USD 256.00');
  });

  it('adds the card variant and updates the shared navigation count', async () => {
    global.fetch = gatewayFetch([
      { path: '/cart', response: jsonResponse(emptyCart) },
      { path: '/cart/items', method: 'POST', body: { variantId, quantity: 1 }, response: jsonResponse(filledCart, 201) },
    ]);
    renderCart(true);
    await screen.findByRole('heading', { name: /your cart is empty/i });
    fireEvent.click(screen.getByRole('button', { name: /add Gateway Lamp to cart/i }));
    expect(await screen.findByRole('link', { name: /cart.*1/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('USD 128.00');
  });

  it('updates quantity while disabling mutations until the response settles', async () => {
    let resolve!: (response: Response) => void;
    global.fetch = gatewayFetch([
      { path: '/cart', response: jsonResponse(filledCart) },
      { path: `/cart/items/${variantId}`, method: 'PATCH', body: { quantity: 2 }, response: new Promise<Response>((done) => { resolve = done; }) },
    ]);
    renderCart();
    const quantity = await screen.findByRole('spinbutton', { name: /quantity.*Gateway Lamp/i });
    fireEvent.change(quantity, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /update.*Gateway Lamp/i }));
    expect(screen.getByRole('button', { name: /clear cart/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove.*Gateway Lamp/i })).toBeDisabled();
    await act(async () => resolve(jsonResponse(updatedCart)));
    expect(await screen.findByRole('link', { name: /cart.*2/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('USD 256.00');
    expect(screen.getByRole('button', { name: /clear cart/i })).toBeEnabled();
  });

  it('submits displayed prices once and renders a pending order with its expiry', async () => {
    let resolveCheckout!: (response: Response) => void;
    const transport = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/cart')) return Promise.resolve(jsonResponse(filledCart));
      expect(url).toBe('https://gateway.example.test/api/checkout');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer browser-token');
      expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/i);
      expect(JSON.parse(init?.body as string)).toEqual({
        expectedPrices: [{ variantId, price_decimal: '128.00', currency: 'USD' }],
      });
      return new Promise<Response>((done) => { resolveCheckout = done; });
    });
    global.fetch = transport as typeof fetch;
    renderCart();

    fireEvent.click(await screen.findByRole('button', { name: /checkout/i }));
    expect(screen.getByRole('button', { name: /checkout/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /checkout/i }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));

    await act(async () => resolveCheckout(jsonResponse({
      orderId: '500c6fcc-154a-4ec3-8a07-5e02b3f04bf4',
      state: 'PENDING',
      currency: 'USD',
      total_decimal: '128.00',
      expiresAt: '2026-10-15T12:15:00.000Z',
      publicationRevision: 1,
      lines: [],
    }, 201)));
    expect(await screen.findByRole('status')).toHaveTextContent(/pending.*2026/i);
  });

  it('refreshes and requires confirmation after canonical checkout prices change', async () => {
    const repricedCart = {
      ...filledCart,
      total: '130.00',
      items: [{ ...filledCart.items[0], price: '130.00', subtotal: '130.00' }],
    };
    const transport = jest.fn(gatewayFetch([
      { path: '/cart', response: jsonResponse(filledCart) },
      {
        path: '/checkout',
        method: 'POST',
        body: { expectedPrices: [{ variantId, price_decimal: '128.00', currency: 'USD' }] },
        response: jsonResponse({
          code: 'CHECKOUT_PRICE_CHANGED',
          message: 'Price changed',
          request_id: 'checkout-price-change',
          details: { currentPrices: [{ variantId, price_decimal: '130.00', currency: 'USD' }] },
        }, 409),
      },
      { path: '/cart', response: jsonResponse(repricedCart) },
      {
        path: '/checkout',
        method: 'POST',
        body: { expectedPrices: [{ variantId, price_decimal: '130.00', currency: 'USD' }] },
        response: jsonResponse({
          orderId: '500c6fcc-154a-4ec3-8a07-5e02b3f04bf4',
          state: 'PENDING',
          currency: 'USD',
          total_decimal: '130.00',
          expiresAt: '2026-10-15T12:15:00.000Z',
          publicationRevision: 1,
          lines: [],
        }, 201),
      },
    ]));
    global.fetch = transport;
    renderCart();

    fireEvent.click(await screen.findByRole('button', { name: /checkout/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/prices changed/i);
    expect(screen.getByRole('button', { name: /confirm updated prices/i })).toBeEnabled();
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('USD 130.00');

    fireEvent.click(screen.getByRole('button', { name: /confirm updated prices/i }));
    expect(await screen.findByText(/order .* is pending until/i)).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it.each(['remove', 'clear'])('refreshes the cart after the %s 204 response', async (action) => {
    global.fetch = gatewayFetch([
      { path: '/cart', response: jsonResponse(filledCart) },
      { path: action === 'remove' ? `/cart/items/${variantId}` : '/cart', method: 'DELETE', response: jsonResponse(undefined, 204) },
      { path: '/cart', response: jsonResponse(emptyCart) },
    ]);
    renderCart();
    fireEvent.click(await screen.findByRole('button', { name: action === 'remove' ? /remove.*Gateway Lamp/i : /clear cart/i }));
    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cart.*0/i })).toBeInTheDocument();
  });

  it('keeps the last cart visible on mutation failure and allows retrying the action', async () => {
    global.fetch = gatewayFetch([
      { path: '/cart', response: jsonResponse(filledCart) },
      { path: `/cart/items/${variantId}`, method: 'PATCH', body: { quantity: 2 }, response: jsonResponse({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock', requestId: 'stock-failure' }, 409) },
      { path: `/cart/items/${variantId}`, method: 'PATCH', body: { quantity: 2 }, response: jsonResponse(updatedCart) },
    ]);
    renderCart();
    fireEvent.change(await screen.findByRole('spinbutton', { name: /quantity.*Gateway Lamp/i }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /update.*Gateway Lamp/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock');
    expect(screen.getByLabelText('Cart total')).toHaveTextContent('USD 128.00');
    fireEvent.click(screen.getByRole('button', { name: /update.*Gateway Lamp/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(await screen.findByRole('link', { name: /cart.*2/i })).toBeInTheDocument();
  });

  it('recovers an initial Gateway error with the retry control', async () => {
    global.fetch = gatewayFetch([
      { path: '/cart', response: jsonResponse({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable', requestId: 'unavailable' }, 503) },
      { path: '/cart', response: jsonResponse(filledCart) },
    ]);
    renderCart();
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.queryByRole('button', { name: /clear cart/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry cart/i }));
    expect(await screen.findByRole('heading', { name: 'Gateway Lamp' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears an initially unreadable cart after a currency mismatch and refreshes through Gateway', async () => {
    const transport = jest.fn(gatewayFetch([
      { path: '/cart', response: jsonResponse({ statusCode: 409, code: 'CART_CURRENCY_MISMATCH', message: 'Cart currency mismatch', requestId: 'currency-mismatch' }, 409) },
      { path: '/cart', method: 'DELETE', response: jsonResponse(undefined, 204) },
      { path: '/cart', response: jsonResponse(emptyCart) },
    ]));
    global.fetch = transport;
    renderCart();
    expect(await screen.findByRole('alert')).toHaveTextContent('Cart currency mismatch');
    expect(screen.queryByRole('heading', { name: /your cart is empty/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }));

    expect(await screen.findByRole('heading', { name: /your cart is empty/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /cart.*0/i })).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each(['missing', 'expired'])('shows an actionable sign-in error for a %s token', async (state) => {
    if (state === 'missing') localStorage.removeItem('nexo.access-token');
    global.fetch = gatewayFetch(state === 'missing' ? [] : [{ path: '/cart', response: jsonResponse({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: 'expired' }, 401) }]);
    renderCart();
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in.*retry/i);
    expect(screen.getByRole('button', { name: /retry cart/i })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: /your cart is empty/i })).not.toBeInTheDocument();
  });

  it('disables add for products without an active variant', async () => {
    global.fetch = gatewayFetch([{ path: '/cart', response: jsonResponse(emptyCart) }]);
    render(<CartProvider><ProductGrid products={[{ ...product, variantId: null }]} /></CartProvider>);
    const unavailable = screen.getByRole('button', { name: /unavailable/i });
    await waitFor(() => expect(unavailable).toBeDisabled());
  });
});
