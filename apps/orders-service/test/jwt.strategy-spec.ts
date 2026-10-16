import { JwtStrategy } from '../src/auth/jwt.strategy';
import { parseEnvironment } from '../src/common/environment';
import { principal, secret, token } from './checkout-harness';

describe('Orders access JWT', () => {
  const strategy = new JwtStrategy(
    parseEnvironment({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      CART_SERVICE_URL: 'http://localhost:3004',
      CATALOG_SERVICE_URL: 'http://localhost:3002',
      JWT_ACCESS_SECRET: secret,
      CART_INTERNAL_SERVICE_TOKEN: 'cart-secret-32-characters-long-value',
      CATALOG_INTERNAL_TOKEN: 'catalog-secret-32-characters-long-value',
    }),
  );
  const authenticate = (jwt: string) =>
    new Promise((resolve) => {
      const passport = strategy as unknown as {
        authenticate(r: unknown): void;
        success(v: unknown): void;
        fail(): void;
        error(): void;
      };
      passport.success = (v) => resolve(v);
      passport.fail = passport.error = () => resolve(null);
      passport.authenticate({ headers: { authorization: `Bearer ${jwt}` } });
    });
  it('accepts existing HS256 access tokens without issuer/audience', async () => {
    expect(await authenticate(token())).toEqual({ id: principal });
  });
  it.each([
    token({ sub: principal, type: 'access' }),
    token({ sub: principal, type: 'access', exp: 1 }),
    token({ sub: principal, type: 'refresh', exp: 9999999999 }),
    token({ sub: 'spoofed', type: 'access', exp: 9999999999 }),
    token(undefined, 'HS384'),
    token(undefined, 'HS256', 'attacker'),
  ])('rejects invalid or spoofed token %#', async (jwt) => {
    expect(await authenticate(jwt)).toBeNull();
  });
});
