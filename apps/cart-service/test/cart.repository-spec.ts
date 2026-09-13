import { CartRepository } from '../src/cart/cart.repository';

describe('CartRepository', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
    isOpen: false,
  };
  let repository: CartRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new CartRepository(redis as never);
  });

  it('returns an empty cart when the user has no Redis key', async () => {
    redis.get.mockResolvedValue(null);

    await expect(repository.getCart(userId)).resolves.toEqual(null);
  });

  it('fails closed when persisted cart JSON is malformed', async () => {
    redis.get.mockResolvedValue('{not-json');

    await expect(repository.getCart(userId)).rejects.toThrow('Invalid persisted cart');
  });

  it('persists only Cart state under its namespaced key for thirty days', async () => {
    const cart = {
      currency: 'USD',
      items: [{ variantId: 'variant-1', quantity: 2 }],
      updatedAt: '2026-09-13T00:00:00.000Z',
    };

    await repository.saveCart(userId, cart);

    expect(redis.set).toHaveBeenCalledWith(
      `cart:${userId}`,
      JSON.stringify(cart),
      { EX: 2_592_000 },
    );
  });

  it('drops extra cart and item properties before persistence', async () => {
    await repository.saveCart(userId, {
      currency: 'USD',
      items: [{ variantId: 'variant-1', quantity: 2, price: '9.99' }],
      updatedAt: '2026-09-13T00:00:00.000Z',
      total: '19.98',
    } as never);

    expect(redis.set).toHaveBeenCalledWith(
      `cart:${userId}`,
      '{"currency":"USD","items":[{"variantId":"variant-1","quantity":2}],"updatedAt":"2026-09-13T00:00:00.000Z"}',
      { EX: 2_592_000 },
    );
  });

  it('deletes the cart key idempotently', async () => {
    redis.del.mockResolvedValue(0);

    await expect(repository.deleteCart(userId)).resolves.toBeUndefined();
    await expect(repository.deleteCart(userId)).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenNthCalledWith(1, `cart:${userId}`);
    expect(redis.del).toHaveBeenNthCalledWith(2, `cart:${userId}`);
  });

  it('connects at startup and quits an open client during shutdown', async () => {
    await repository.onApplicationBootstrap();
    redis.isOpen = true;
    await repository.onApplicationShutdown();

    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });
});
