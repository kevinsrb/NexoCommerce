import { parseEnvironment } from '../src/common/environment';

describe('Catalog environment', () => {
  const DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db';
  const JWT_ACCESS_SECRET = 'access-secret-for-catalog-tests-at-least-32-characters';
  const CATALOG_INTERNAL_TOKEN = 'catalog-internal-token-at-least-32-characters';
  const CATALOG_ADMIN_SECRET = 'catalog-admin-secret-for-tests-at-least-32';

  it('defaults to the catalog port and accepts PostgreSQL', () => {
    expect(parseEnvironment({ DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET })).toEqual({
      DATABASE_URL,
      JWT_ACCESS_SECRET,
      CATALOG_INTERNAL_TOKEN,
      CATALOG_ADMIN_SECRET,
      NODE_ENV: 'development',
      PORT: 3002,
    });
  });

  it.each([
    {},
    { DATABASE_URL: 'https://example.com', JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET },
    { DATABASE_URL: 'invalid', JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET },
    { DATABASE_URL, JWT_ACCESS_SECRET: 'short', CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET: JWT_ACCESS_SECRET },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET: CATALOG_INTERNAL_TOKEN },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET, PORT: '0' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET, PORT: '65536' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET, PORT: 'abc' },
    { DATABASE_URL, JWT_ACCESS_SECRET, CATALOG_INTERNAL_TOKEN, CATALOG_ADMIN_SECRET, NODE_ENV: 'staging' },
  ])('rejects invalid runtime configuration: %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow();
  });
});
