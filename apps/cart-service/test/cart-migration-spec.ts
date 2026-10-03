import { migrateLegacyCart } from '../src/cart/cart-migration';

describe('legacy Cart key migration', () => {
  const principalId = '550e8400-e29b-41d4-a716-446655440000';
  const redis = { eval: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it('moves the legacy payload and seeds a nonexpiring version atomically', async () => {
    redis.eval.mockResolvedValue(1);
    await expect(migrateLegacyCart(redis, principalId)).resolves.toBe('migrated');
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: [`cart:${principalId}`, `cart:data:${principalId}`, `cart:version:${principalId}`, `cart:claim:${principalId}`],
      arguments: [],
    });
  });

  it('fails closed when a legacy payload conflicts with Phase 3 state', async () => {
    redis.eval.mockResolvedValue(-1);
    await expect(migrateLegacyCart(redis, principalId)).rejects.toThrow('Cart migration conflict');
  });

  it('ignores a key already migrated by an earlier pass', async () => {
    redis.eval.mockResolvedValue(0);
    await expect(migrateLegacyCart(redis, principalId)).resolves.toBe('absent');
  });
});
