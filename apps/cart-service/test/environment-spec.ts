import { parseEnvironment } from '../src/common/environment';

describe('Cart environment', () => {
  const valid = {
    REDIS_URL: 'redis://localhost:6379',
    CATALOG_SERVICE_URL: 'http://localhost:3002',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
  };

  it.each([
    {},
    { ...valid, REDIS_URL: 'not-a-url' },
    { ...valid, REDIS_URL: 'http://localhost:6379' },
    { ...valid, CATALOG_SERVICE_URL: 'not-a-url' },
    { ...valid, JWT_ACCESS_SECRET: 'short' },
    { ...valid, PORT: '0' },
    { ...valid, PORT: '65536' },
    { ...valid, PORT: 'abc' },
  ])('rejects invalid runtime configuration: %j', (input) => {
    expect(() => parseEnvironment(input)).toThrow();
  });

  it('defaults to Cart port with valid dependencies', () => {
    expect(parseEnvironment(valid)).toEqual({ ...valid, NODE_ENV: 'development', PORT: 3003 });
  });
});
