import { parseEnvironment } from '../src/common/environment';

describe('Catalog environment', () => {
  const DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db';
  const JWT_ACCESS_SECRET = 'access-secret-for-catalog-tests-at-least-32-characters';
  const CATALOG_INTERNAL_TOKEN = 'catalog-internal-token-at-least-32-characters';

  it('defaults to the catalog port and accepts PostgreSQL', () => {
    expect(parseEnvironment({ DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN })).toEqual({
      DATABASE_URL,
      JWT_ACCESS_SECRET,
      CATALOG_INTERNAL_TOKEN,
      NODE_ENV: 'development',
      PORT: 3002,
    });
  });

  it.each([
    {},
    { DATABASE_URL: 'https://example.com', JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN },
    { DATABASE_URL: 'invalid', JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN },
    { DATABASE_URL, JWT_ACCESS_SECRET: 'short', CATALOG_INTERNAL_TOKEN },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, PORT: '0' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, PORT: '65536' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, PORT: 'abc' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, NODE_ENV: 'staging' },
  ])('rejects invalid runtime configuration: %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow();
  });
});
