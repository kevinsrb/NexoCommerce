import { parseGatewayEnvironment, parseOrdersEnvironment } from './index';

describe('Phase 3 service configuration', () => {
  const gateway = {
    AUTH_SERVICE_URL: 'http://localhost:3001',
    CATALOG_SERVICE_URL: 'http://localhost:3002',
    CART_SERVICE_URL: 'http://localhost:3004',
    ORDERS_SERVICE_URL: 'http://localhost:3005',
  };

  it('requires an HTTP(S) Orders origin at Gateway and defaults checkout closed', () => {
    expect(parseGatewayEnvironment(gateway)).toMatchObject({
      ORDERS_SERVICE_URL: gateway.ORDERS_SERVICE_URL,
      CHECKOUT_ENABLED: false,
    });
    expect(
      (parseGatewayEnvironment({ ...gateway, CHECKOUT_ENABLED: 'true' }) as Record<string, unknown>)
        .CHECKOUT_ENABLED,
    ).toBe(true);
    const missing = { ...gateway };
    delete (missing as Partial<typeof gateway>).ORDERS_SERVICE_URL;
    expect(() => parseGatewayEnvironment(missing)).toThrow();
    expect(() => parseGatewayEnvironment({ ...gateway, ORDERS_SERVICE_URL: 'https://example.com/private' })).toThrow();
    expect(() => parseGatewayEnvironment({ ...gateway, CHECKOUT_ENABLED: 'not-a-boolean' })).toThrow();
  });

  it('requires the Orders dependency URLs and secrets', () => {
    const valid = {
      DATABASE_URL: 'postgresql://localhost:5432/order_db',
      CART_SERVICE_URL: gateway.CART_SERVICE_URL,
      CATALOG_SERVICE_URL: gateway.CATALOG_SERVICE_URL,
      JWT_ACCESS_SECRET: 'access-secret-at-least-32-characters',
      CART_INTERNAL_SERVICE_TOKEN: 'cart-token-at-least-32-characters',
      CATALOG_INTERNAL_TOKEN: 'catalog-token-at-least-32-characters',
    };
    expect(parseOrdersEnvironment(valid)).toMatchObject(valid);
    expect(() => parseOrdersEnvironment({ ...valid, CART_SERVICE_URL: 'https://example.com/path' })).toThrow();
    expect(() => parseOrdersEnvironment({ ...valid, CATALOG_INTERNAL_TOKEN: 'short' })).toThrow();
    expect(() => parseOrdersEnvironment({ ...valid, CATALOG_INTERNAL_TOKEN: valid.CART_INTERNAL_SERVICE_TOKEN })).toThrow();
  });
});
