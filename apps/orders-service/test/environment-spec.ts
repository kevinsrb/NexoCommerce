import { parseOrdersEnvironment } from '@nexo/config';
import { parseEnvironment } from '../src/common/environment';

describe('Orders environment', () => {
  const valid = {
    DATABASE_URL: 'postgresql://nexo:password@localhost:5432/order_db',
    CART_SERVICE_URL: 'http://localhost:3004',
    CATALOG_SERVICE_URL: 'http://localhost:3002',
    JWT_ACCESS_SECRET: 'orders-access-secret-at-least-32-characters',
    CART_INTERNAL_SERVICE_TOKEN: 'orders-cart-token-at-least-32-characters',
    CATALOG_INTERNAL_TOKEN: 'orders-catalog-token-at-least-32-characters',
  };

  it('uses port 3005 and accepts valid service configuration', () => {
    expect(parseEnvironment(valid)).toEqual({ ...valid, NODE_ENV: 'development', PORT: 3005 });
  });

  it.each(['DATABASE_URL', 'CART_SERVICE_URL', 'CATALOG_SERVICE_URL', 'JWT_ACCESS_SECRET', 'CART_INTERNAL_SERVICE_TOKEN', 'CATALOG_INTERNAL_TOKEN'] as const)(
    'requires %s',
    (key) => {
      const input: Record<string, string> = { ...valid };
      delete input[key];
      expect(() => parseOrdersEnvironment(input)).toThrow();
    },
  );

  it.each([
    { DATABASE_URL: 'https://example.com' },
    { CART_SERVICE_URL: 'ftp://localhost:3004' },
    { CART_SERVICE_URL: 'http://localhost:3004/private' },
    { CATALOG_SERVICE_URL: 'http://user:pass@localhost:3002' },
    { CATALOG_SERVICE_URL: 'http://localhost:3002?secret=x' },
    { JWT_ACCESS_SECRET: 'short' },
    { CART_INTERNAL_SERVICE_TOKEN: 'short' },
    { CATALOG_INTERNAL_TOKEN: 'short' },
    { CART_INTERNAL_SERVICE_TOKEN: valid.JWT_ACCESS_SECRET },
    { CATALOG_INTERNAL_TOKEN: valid.JWT_ACCESS_SECRET },
    { CATALOG_INTERNAL_TOKEN: valid.CART_INTERNAL_SERVICE_TOKEN },
    { PORT: '0' },
    { PORT: '65536' },
  ])('rejects invalid or shared secrets and URLs: %j', (override) => {
    expect(() => parseEnvironment({ ...valid, ...override })).toThrow();
  });
});
