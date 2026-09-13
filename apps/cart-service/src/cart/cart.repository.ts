import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';

export interface PersistedCart {
  currency: string;
  items: Array<{ variantId: string; quantity: number }>;
  updatedAt: string;
}

const CART_TTL_SECONDS = 2_592_000;

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
      return JSON.parse(serialized) as PersistedCart;
    } catch {
      throw new Error('Invalid persisted cart');
    }
  }

  async saveCart(userId: string, cart: PersistedCart): Promise<void> {
    await this.redis.set(this.key(userId), JSON.stringify(cart), { EX: CART_TTL_SECONDS });
  }

  async deleteCart(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }

  private key(userId: string): string {
    return `cart:${userId}`;
  }
}
