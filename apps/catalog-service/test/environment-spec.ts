import { parseEnvironment } from '../src/common/environment';

describe('Catalog environment', () => {
  const DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db';
  const JWT_ACCESS_SECRET = 'access-secret-for-catalog-tests-at-least-32-characters';

  it('defaults to the catalog port and accepts PostgreSQL', () => {
    expect(parseEnvironment({ DATABASE_URL, JWT_ACCESS_SECRET })).toEqual({
      DATABASE_URL,
      JWT_ACCESS_SECRET,
      NODE_ENV: 'development',
      PORT: 3002,
    });
  });

  it.each([
    {},
    { DATABASE_URL: 'https://example.com', JWT_ACCESS_SECRET },
    { DATABASE_URL: 'invalid', JWT_ACCESS_SECRET },
    { DATABASE_URL, JWT_ACCESS_SECRET: 'short' },
    { DATABASE_URL, JWT_ACCESS_SECRET, PORT: '0' },
    { DATABASE_URL, JWT_ACCESS_SECRET, PORT: '65536' },
    { DATABASE_URL, JWT_ACCESS_SECRET, PORT: 'abc' },
    { DATABASE_URL, JWT_ACCESS_SECRET, NODE_ENV: 'staging' },
  ])('rejects invalid runtime configuration: %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow();
  });
});
