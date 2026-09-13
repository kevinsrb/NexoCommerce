import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/auth/jwt.strategy';

describe('Cart JwtStrategy', () => {
  const strategy = new JwtStrategy({
    PORT: 3003,
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    CATALOG_SERVICE_URL: 'http://localhost:3002',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
  });

  it('maps only UUID access subjects to the local user identity', () => {
    expect(strategy.validate({ sub: '550e8400-e29b-41d4-a716-446655440000', type: 'access' })).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it.each([
    { sub: 'not-a-uuid', type: 'access' },
    { sub: '550e8400-e29b-41d4-a716-446655440000', type: 'refresh' },
    { type: 'access' },
  ])('rejects invalid Auth token claims: %j', (payload) => {
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });
});
