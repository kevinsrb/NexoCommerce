import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from '../src/auth/jwt.strategy';

describe('Cart JwtStrategy', () => {
  const strategy = new JwtStrategy({
    PORT: 3003,
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    CATALOG_SERVICE_URL: 'http://localhost:3002',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    CATALOG_INTERNAL_TOKEN: 'b'.repeat(32),
    CART_INTERNAL_SERVICE_TOKEN: 'c'.repeat(32),
  });
  const signer = new JwtService({ secret: 'a'.repeat(32) });

  const authenticate = (token: string): Promise<{ user?: unknown }> =>
    new Promise((resolve) => {
      const passportStrategy = strategy as unknown as {
        authenticate(request: { headers: { authorization: string } }): void;
        success(user: unknown): void;
        fail(): void;
        error(): void;
      };
      passportStrategy.success = (user) => resolve({ user });
      passportStrategy.fail = () => resolve({});
      passportStrategy.error = () => resolve({});
      passportStrategy.authenticate({ headers: { authorization: `Bearer ${token}` } });
    });

  it('maps only UUID access subjects to the local user identity', () => {
    expect(
      strategy.validate({
        sub: '550e8400-e29b-41d4-a716-446655440000',
        type: 'access',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toEqual({ id: '550e8400-e29b-41d4-a716-446655440000' });
  });

  it.each([
    { sub: 'not-a-uuid', type: 'access' },
    { sub: '550e8400-e29b-41d4-a716-446655440000', type: 'refresh' },
    { type: 'access' },
  ])('rejects invalid Auth token claims: %j', (payload) => {
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('accepts a signed, unexpired HS256 Auth access token', async () => {
    const token = signer.sign({
      sub: '550e8400-e29b-41d4-a716-446655440000',
      type: 'access',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    await expect(authenticate(token)).resolves.toEqual({
      user: { id: '550e8400-e29b-41d4-a716-446655440000' },
    });
  });

  it.each([
    ['without expiration', { sub: '550e8400-e29b-41d4-a716-446655440000', type: 'access' }, 'HS256'],
    [
      'when expired',
      { sub: '550e8400-e29b-41d4-a716-446655440000', type: 'access', exp: 1 },
      'HS256',
    ],
    [
      'when signed with another algorithm',
      {
        sub: '550e8400-e29b-41d4-a716-446655440000',
        type: 'access',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'HS384',
    ],
  ])('rejects an Auth access token %s', async (_case, payload, algorithm) => {
    const token = signer.sign(payload, { algorithm: algorithm as 'HS256' });

    await expect(authenticate(token)).resolves.toEqual({});
  });
});
