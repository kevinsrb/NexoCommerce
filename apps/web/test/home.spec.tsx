import { act, fireEvent, render, screen } from '@testing-library/react';

import Home from '../app/page';
import { ProductStates } from '../components/product-states';
import { CartProvider } from '../components/cart-provider';
import { emptyCart, filledCart, jsonResponse, variantId } from './cart-fixtures';

const testProducts = [
  {
    id: 'lamp',
    variantId: 'lamp-standard',
    name: 'Arc Lamp',
    description: 'Soft, directed light for slower evenings.',
    price: '$128.00',
    category: 'Living',
    accent: 'from-amber-200/70 to-orange-500/20',
  },
];

describe('Home', () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://gateway.example.test/api';
    global.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('renders the storefront navigation, hero, and loading product boundary', async () => {
    await act(async () => { render(<CartProvider><Home /></CartProvider>); });

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /commerce that feels effortless/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /featured essentials/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /loading products/i })).toBeInTheDocument();
  });

  it('links Experience to the rendered product-state boundary', async () => {
    await act(async () => { render(<CartProvider><Home /></CartProvider>); });

    expect(screen.getByRole('link', { name: /experience/i })).toHaveAttribute('href', '/#states');
    expect(document.getElementById('states')).toBeInTheDocument();
  });

  it('adds the catalog-selected active variant from Home and exposes its cart link', async () => {
    localStorage.setItem('nexo.access-token', 'browser-token');
    global.fetch = (async (input, init) => {
      const url = String(input);
      expect(url.startsWith('https://gateway.example.test/api/')).toBe(true);
      if (url.endsWith('/products')) return jsonResponse([{
        id: filledCart.items[0].productId, name: 'Gateway Lamp', slug: 'gateway-lamp',
        description: 'A warm light.', active: true, category: { id: 'lighting', name: 'Lighting', slug: 'lighting' },
        variants: [
          { id: 'inactive', name: 'Retired', sku: 'OLD', active: false, price: '1.00', currency: 'USD', stock: 0 },
          { id: variantId, name: 'Standard', sku: 'LAMP', active: true, price: '128.00', currency: 'USD', stock: 4 },
        ],
      }]);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer browser-token');
      if (url.endsWith('/cart') && init?.method === 'GET') return jsonResponse(emptyCart);
      expect(url).toBe('https://gateway.example.test/api/cart/items');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ variantId, quantity: 1 });
      return jsonResponse(filledCart, 201);
    }) as typeof fetch;
    render(<CartProvider><Home /></CartProvider>);
    const add = await screen.findByRole('button', { name: /add Gateway Lamp to cart/i });
    fireEvent.click(add);
    expect(await screen.findByRole('link', { name: /cart.*1/i })).toHaveAttribute('href', '/cart');
  });
});

describe('ProductStates', () => {
  it('renders the product grid in ready mode', async () => {
    await act(async () => { render(<CartProvider><ProductStates state="ready" products={testProducts} /></CartProvider>); });

    expect(screen.getByRole('list', { name: /product grid/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /arc lamp/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /loading products/i })).not.toBeInTheDocument();
  });

  it.each([
    ['loading', 'Loading products'],
    ['empty', 'Nothing here yet'],
    ['error', "We couldn't load products"],
  ] as const)('renders only the %s product state without the grid', (state, stateHeading) => {
    render(<ProductStates state={state} products={testProducts} />);

    expect(screen.getByRole('heading', { name: stateHeading })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /product grid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /arc lamp/i })).not.toBeInTheDocument();

    for (const otherHeading of ['Loading products', 'Nothing here yet', "We couldn't load products"]) {
      if (otherHeading !== stateHeading) {
        expect(screen.queryByRole('heading', { name: otherHeading })).not.toBeInTheDocument();
      }
    }
  });
});
