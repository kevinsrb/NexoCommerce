import { render, screen, waitFor } from '@testing-library/react';

import Home from '../app/page';
import { ProductStates } from '../components/product-states';

const testProducts = [
  {
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
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('renders the storefront navigation, hero, and loading product boundary', async () => {
    render(<Home />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /commerce that feels effortless/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /featured essentials/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /loading products/i })).toBeInTheDocument();
  });

  it('links Experience to the rendered product-state boundary', async () => {
    render(<Home />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('link', { name: /experience/i })).toHaveAttribute('href', '#states');
    expect(document.getElementById('states')).toBeInTheDocument();
  });
});

describe('ProductStates', () => {
  it('renders the product grid in ready mode', () => {
    render(<ProductStates state="ready" products={testProducts} />);

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
