import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

export interface PersistedCart {
  currency: string;
  items: Array<{ variantId: string; quantity: number }>;
  updatedAt: string;
}

const CART_TTL_SECONDS = 2_592_000;

const isPersistedCart = (value: unknown): value is PersistedCart => {
  if (typeof value !== 'object' || value === null) return false;
  const cart = value as Record<string, unknown>;
  return (
    typeof cart.currency === 'string' &&
    /^[A-Z]{3}$/.test(cart.currency) &&
    Array.isArray(cart.items) &&
    cart.items.length <= 100 &&
    cart.items.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const line = item as Record<string, unknown>;
      return (
        typeof line.variantId === 'string' &&
        Number.isSafeInteger(line.quantity) &&
        (line.quantity as number) >= 1
      );
    }) &&
    typeof cart.updatedAt === 'string' &&
    Number.isFinite(Date.parse(cart.updatedAt))
  );
};

export interface CartRedisClient {
  isOpen: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

@Injectable()
export class CartRepository implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly redis: CartRedisClient) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.redis.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  async getCart(userId: string): Promise<PersistedCart | null> {
    const serialized = await this.redis.get(this.key(userId));
    if (serialized === null) return null;
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!isPersistedCart(parsed)) throw new Error('Invalid persisted cart');
      return parsed;
    } catch {
      throw new Error('Invalid persisted cart');
    }
  }

  async saveCart(userId: string, cart: PersistedCart): Promise<void> {
    const persisted: PersistedCart = {
      currency: cart.currency,
      items: cart.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
      updatedAt: cart.updatedAt,
    };
    await this.redis.set(this.key(userId), JSON.stringify(persisted), { EX: CART_TTL_SECONDS });
  }

  async deleteCart(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }

  private key(userId: string): string {
    return `cart:${userId}`;
  }
}
