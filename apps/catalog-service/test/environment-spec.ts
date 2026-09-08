import { parseEnvironment } from '../src/common/environment';

describe('Catalog environment', () => {
  const DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db';

  it('defaults to the catalog port and accepts PostgreSQL', () => {
    expect(parseEnvironment({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      NODE_ENV: 'development',
      PORT: 3002,
    });
  });

  it.each([
    {},
    { DATABASE_URL: 'https://example.com' },
    { DATABASE_URL: 'invalid' },
    { DATABASE_URL, PORT: '0' },
    { DATABASE_URL, PORT: '65536' },
    { DATABASE_URL, PORT: 'abc' },
    { DATABASE_URL, NODE_ENV: 'staging' },
  ])('rejects invalid runtime configuration: %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow();
  });
});
