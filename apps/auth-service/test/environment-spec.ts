import { parseEnvironment } from '../src/common/environment';

describe('Auth environment', () => {
  const valid = {
    DATABASE_URL: 'postgresql://nexo:password@localhost:5432/auth_db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    CATALOG_ADMIN_SECRET: 'c'.repeat(32),
  };
  it('requires valid database and independent strong secrets', () => {
    expect(() => parseEnvironment({})).toThrow();
    expect(() => parseEnvironment({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow();
    expect(() =>
      parseEnvironment({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET }),
    ).toThrow();
    expect(() => parseEnvironment({ ...valid, DATABASE_URL: 'https://example.com' })).toThrow();
    expect(() => parseEnvironment({ ...valid, JWT_ACCESS_TTL_SECONDS: '1.5' })).toThrow();
    expect(() => parseEnvironment({ ...valid, JWT_REFRESH_TTL_SECONDS: '0' })).toThrow();
    expect(() => parseEnvironment({ ...valid, CATALOG_ADMIN_SECRET: valid.JWT_ACCESS_SECRET })).toThrow();
    expect(() => parseEnvironment({ ...valid, CATALOG_ADMIN_SECRET: valid.JWT_REFRESH_SECRET })).toThrow();
    expect(parseEnvironment(valid).JWT_ACCESS_TTL_SECONDS).toBe(900);
  });
});
