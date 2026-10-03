import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { migrateLegacyCart } from '../src/cart/cart-migration';
import { CartRepository, type CartRedisClient } from '../src/cart/cart.repository';

const describeRedis = process.env.CART_TEST_REDIS_URL ? describe : describe.skip;

describeRedis('Cart Lua contracts against Redis', () => {
  const redis = createClient({
    url: process.env.CART_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    socket: { reconnectStrategy: () => false },
  });
  let principalId: string;
  let keys: string[];
  const variantId = '550e8400-e29b-41d4-a716-446655440001';
  const valid = {
    currency: 'USD',
    items: [{ variantId, quantity: 2 }],
    updatedAt: '2026-10-02T12:34:56.000Z',
  };

  beforeAll(async () => { await redis.connect(); });
  afterAll(async () => { if (redis.isOpen) await redis.quit(); });
  beforeEach(() => {
    principalId = randomUUID();
    keys = [`cart:${principalId}`, `cart:data:${principalId}`, `cart:version:${principalId}`, `cart:claim:${principalId}`];
  });
  afterEach(async () => { if (redis.isOpen) await redis.del(keys); });

  it('migrates a valid legacy payload atomically and retains its remaining TTL', async () => {
    await redis.set(keys[0], JSON.stringify(valid), { EX: 60 });
    await expect(migrateLegacyCart(redis, principalId)).resolves.toBe('migrated');
    expect(await redis.get(keys[0])).toBeNull();
    expect(JSON.parse((await redis.get(keys[1]))!)).toEqual(valid);
    expect(await redis.get(keys[2])).toBe('1');
    expect(await redis.ttl(keys[1])).toBeGreaterThan(0);
    expect(await redis.ttl(keys[2])).toBe(-1);
  });

  it.each([
    ['currency', { ...valid, currency: 'usd' }],
    ['items object', { ...valid, items: { first: valid.items[0] } }],
    ['missing variant ID', { ...valid, items: [{ quantity: 2 }] }],
    ['malformed variant ID', { ...valid, items: [{ variantId: 'bad', quantity: 2 }] }],
    ['zero quantity', { ...valid, items: [{ variantId, quantity: 0 }] }],
    ['fractional quantity', { ...valid, items: [{ variantId, quantity: 1.5 }] }],
    ['unsafe quantity', { ...valid, items: [{ variantId, quantity: 9007199254740992 }] }],
    ['invalid timestamp', { ...valid, updatedAt: 'not-a-date' }],
    ['impossible timestamp', { ...valid, updatedAt: '2026-02-30T12:34:56.000Z' }],
    ['too many lines', { ...valid, items: Array.from({ length: 101 }, () => valid.items[0]) }],
    ['duplicate variants', { ...valid, items: [valid.items[0], valid.items[0]] }],
  ])('leaves malformed legacy %s untouched', async (_case, payload) => {
    const serialized = JSON.stringify(payload);
    await redis.set(keys[0], serialized, { EX: 60 });
    await expect(migrateLegacyCart(redis, principalId)).rejects.toThrow('Invalid legacy Cart payload');
    expect(await redis.get(keys[0])).toBe(serialized);
    expect(await redis.exists(keys.slice(1))).toBe(0);
  });

  it('persists the version and active claim across payload TTL changes', async () => {
    const repository = new CartRepository(redis as unknown as CartRedisClient);
    expect(await repository.readCheckoutSnapshot(principalId)).toEqual({ version: 0, lines: [] });
    await repository.mutateCart(principalId, {
      operation: 'add', variantId, quantity: 2, currency: 'USD', stock: 10,
      updatedAt: valid.updatedAt, validatedIds: [variantId],
    });
    expect(await redis.get(keys[2])).toBe('1');
    expect(await redis.ttl(keys[1])).toBeGreaterThan(0);
    const attemptId = randomUUID();
    expect(await repository.claimCheckout(principalId, attemptId, 1)).toEqual({ version: 1, lines: valid.items });
    expect(await redis.ttl(keys[1])).toBe(-1);
    expect(await redis.ttl(keys[3])).toBe(-1);
    await expect(repository.getMutableCart(principalId)).rejects.toMatchObject({
      code: 'CART_CHECKOUT_IN_PROGRESS',
    });
    expect(await repository.mutateCart(principalId, { operation: 'clear' })).toBe(-7);
    expect(await repository.releaseCheckout(principalId, attemptId, 1)).toEqual({ version: 1, lines: valid.items });
    expect(await redis.ttl(keys[1])).toBeGreaterThan(0);
    const nextAttemptId = randomUUID();
    await repository.claimCheckout(principalId, nextAttemptId, 1);
    expect(await repository.releaseCheckout(principalId, attemptId, 1)).toEqual({ version: 1, lines: valid.items });
    expect(await repository.completeCheckout(principalId, nextAttemptId, 1)).toEqual({ version: 2, lines: [] });
    expect(await redis.get(keys[2])).toBe('2');
    expect(await redis.ttl(keys[2])).toBe(-1);
    await repository.mutateCart(principalId, {
      operation: 'add', variantId, quantity: 1, currency: 'USD', stock: 10,
      updatedAt: valid.updatedAt, validatedIds: [variantId],
    });
    expect(await repository.readCheckoutSnapshot(principalId)).toEqual({ version: 3, lines: [{ variantId, quantity: 1 }] });
    expect(await repository.completeCheckout(principalId, nextAttemptId, 1)).toEqual({ version: 2, lines: [] });
    await redis.del(keys[1]); // Simulate expiry of the unclaimed 30-day payload.
    expect(await repository.readCheckoutSnapshot(principalId)).toEqual({ version: 3, lines: [] });
    await repository.mutateCart(principalId, {
      operation: 'add', variantId, quantity: 1, currency: 'USD', stock: 10,
      updatedAt: valid.updatedAt, validatedIds: [variantId],
    });
    expect(await redis.get(keys[2])).toBe('4');
    await expect(repository.claimCheckout(principalId, randomUUID(), 3)).rejects.toMatchObject({
      code: 'CART_VERSION_CHANGED',
    });
  });
});
