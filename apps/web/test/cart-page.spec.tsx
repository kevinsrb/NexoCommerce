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
    fireEvent.click(screen.getByRole('button', { name: /retry cart/i }));
    expect(await screen.findByRole('heading', { name: 'Gateway Lamp' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
