export const variantId = 'f781f969-2f7e-4f61-8f57-ef324f6f05d3';
export const emptyCart = { currency: null, items: [], total: '0.00', itemCount: 0 };
export const filledCart = {
  currency: 'USD', total: '128.00', itemCount: 1,
  items: [{
    variantId, productId: '3076e554-7586-4deb-b2c9-8e4e29e041d8',
    productName: 'Gateway Lamp', variantName: 'Standard', price: '128.00',
    currency: 'USD', stock: 4, productActive: true, variantActive: true,
    quantity: 1, subtotal: '128.00',
  }],
};
export const updatedCart = {
  ...filledCart, total: '256.00', itemCount: 2,
  items: [{ ...filledCart.items[0], quantity: 2, subtotal: '256.00' }],
};

export const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (status === 204) throw new Error('A 204 response has no JSON body');
    return body;
  },
}) as Response;

type Exchange = { path: string; method?: string; body?: unknown; response: Response | Promise<Response> };

// Controlled external transport; all application components and HTTP clients stay real.
export function gatewayFetch(exchanges: Exchange[]): typeof fetch {
  let index = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const exchange = exchanges[index++];
    if (!exchange) throw new Error('Unexpected Gateway request');
    expect(String(input)).toBe(`https://gateway.example.test/api${exchange.path}`);
    expect(String(input)).not.toContain('CART_' + 'SERVICE_URL');
    expect(init?.method ?? 'GET').toBe(exchange.method ?? 'GET');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer browser-token');
    expect(headers.get('Accept')).toBe('application/json');
    if (exchange.body) {
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toEqual(exchange.body);
    }
    return exchange.response;
  }) as typeof fetch;
}
