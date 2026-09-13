import { render, screen } from '@testing-library/react';

import { ProductCatalog } from '../components/product-catalog';
import { loadCatalogProducts } from '../lib/catalog';

const catalogResponse = [
  {
    id: '3076e554-7586-4deb-b2c9-8e4e29e041d8',
    name: 'Gateway Lamp',
    slug: 'gateway-lamp',
    description: 'A product loaded through the public API gateway.',
    active: true,
    category: {
      id: '0c1b3c55-bdd5-4467-8c86-1538229d18d3',
      name: 'Lighting',
      slug: 'lighting',
    },
    variants: [
      {
        id: 'f781f969-2f7e-4f61-8f57-ef324f6f05d3',
        sku: 'LAMP-001',
        name: 'Standard',
        price: '128.00',
        currency: 'USD',
        stock: 4,
        active: true,
      },
    ],
  },
];

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, json: async () => body }) as Response;

describe('public Gateway catalog client', () => {
  const originalFetch = global.fetch;
  const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'https://gateway.example.test/api';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalGatewayUrl === undefined) delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl;
  });

  it('loads Catalog products from the configured public Gateway URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(catalogResponse));
    global.fetch = fetchMock as typeof fetch;

    await expect(loadCatalogProducts()).resolves.toEqual([
      expect.objectContaining({
        name: 'Gateway Lamp',
        category: 'Lighting',
        price: '$128.00',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith('https://gateway.example.test/api/products', {
      headers: { Accept: 'application/json' },
    });
  });

  it('renders Gateway data through the ready state', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(catalogResponse)) as typeof fetch;

    render(<ProductCatalog />);

    expect(await screen.findByRole('heading', { name: 'Gateway Lamp' })).toBeInTheDocument();
  });

  it('renders an empty response through the empty state', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([])) as typeof fetch;

    render(<ProductCatalog />);

    expect(await screen.findByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
  });

  it('renders an unavailable Gateway through the error state', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused')) as typeof fetch;

    render(<ProductCatalog />);

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load products");
  });
});
