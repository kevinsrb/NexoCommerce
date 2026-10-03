import { CartRepository } from '../src/cart/cart.repository';

describe('CartRepository three-key protocol', () => {
  const principalId = '550e8400-e29b-41d4-a716-446655440000';
  const keys = [`cart:data:${principalId}`, `cart:version:${principalId}`, `cart:claim:${principalId}`];
  const cart = { currency: 'USD', items: [{ variantId: 'variant-1', quantity: 2 }], updatedAt: '2026-09-13T00:00:00.000Z' };
  const redis = { eval: jest.fn(), connect: jest.fn(), quit: jest.fn(), isOpen: false };
  let repository: CartRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new CartRepository(redis as never);
  });

  it('reads cart and version atomically with all three keys', async () => {
    redis.eval.mockResolvedValue(JSON.stringify({ status: 'ok', version: 4, cart }));
    await expect(repository.readCheckoutSnapshot(principalId)).resolves.toEqual({
      version: 4, lines: [{ variantId: 'variant-1', quantity: 2 }],
    });
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), { keys, arguments: ['read'] });
  });

  it('returns the retained version after payload expiry', async () => {
    redis.eval.mockResolvedValue(JSON.stringify({ status: 'ok', version: 7, cart: null }));
    await expect(repository.readCheckoutSnapshot(principalId)).resolves.toEqual({ version: 7, lines: [] });
    await expect(repository.getCart(principalId)).resolves.toBeNull();
  });

  it('fails closed on a missing counter with live data or claim', async () => {
    redis.eval.mockResolvedValue(JSON.stringify({ status: 'integrity' }));
    await expect(repository.getCart(principalId)).rejects.toThrow('Cart storage unavailable');
  });

  it('sends mutations through the atomic script and maps claimed edits', async () => {
    redis.eval.mockResolvedValue(JSON.stringify({ status: 'claimed' }));
    await expect(repository.mutateCart(principalId, {
      operation: 'add', variantId: 'variant-1', quantity: 2, currency: 'USD', stock: 5,
      updatedAt: cart.updatedAt, validatedIds: ['variant-1'],
    })).resolves.toBe(-7);
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), {
      keys, arguments: ['add', 'variant-1', '2', 'USD', '5', '2592000', cart.updatedAt, '["variant-1"]'],
    });
  });

  it('binds claim and terminal calls to attempt and version', async () => {
    redis.eval.mockResolvedValue(JSON.stringify({ status: 'ok', version: 4, cart }));
    await expect(repository.claimCheckout(principalId, 'attempt-1', 4)).resolves.toEqual({
      version: 4, lines: [{ variantId: 'variant-1', quantity: 2 }],
    });
    await repository.releaseCheckout(principalId, 'attempt-1', 4);
    await repository.completeCheckout(principalId, 'attempt-1', 4);
    expect(redis.eval.mock.calls.map((call) => call[1])).toEqual([
      { keys, arguments: ['claim', 'attempt-1', '4'] },
      { keys, arguments: ['release', 'attempt-1', '4', '2592000'] },
      { keys, arguments: ['complete', 'attempt-1', '4', '2592000'] },
    ]);
  });

  it('connects and quits its Redis client', async () => {
    await repository.onApplicationBootstrap();
    redis.isOpen = true;
    await repository.onApplicationShutdown();
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });
});
