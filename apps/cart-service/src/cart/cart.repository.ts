import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CartStorageUnavailableException } from '../common/cart-domain.exception';

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
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export type CartMutation =
  | { operation: 'add'; variantId: string; quantity: number; currency: string; stock: number; updatedAt: string; validatedIds: string[] }
  | { operation: 'update'; variantId: string; quantity: number; currency: string; stock: number; updatedAt: string; validatedIds: string[] }
  | { operation: 'remove'; variantId: string; updatedAt: string }
  | { operation: 'clear' };

export const CART_MUTATION_SCRIPT = `
local key = KEYS[1]
local operation = ARGV[1]
local variantId = ARGV[2]
local quantity = tonumber(ARGV[3])
local currency = ARGV[4]
local stock = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local updatedAt = ARGV[7]
local raw = redis.call('GET', key)
local cart = raw and cjson.decode(raw) or nil

if operation == 'clear' then
  return redis.call('DEL', key)
end

if operation == 'remove' then
  if not cart then return 0 end
  local items = {}
  local removed = false
  for _, item in ipairs(cart.items) do
    if item.variantId == variantId then
      removed = true
    else
      table.insert(items, item)
    end
  end
  if not removed then return 0 end
  if #items == 0 then
    redis.call('DEL', key)
    return 1
  end
  cart.items = items
  cart.updatedAt = updatedAt
  redis.call('SET', key, cjson.encode(cart), 'EX', ttl)
  return 1
end

if not cart then
  if operation ~= 'add' then return -4 end
  cart = { currency = currency, items = {}, updatedAt = updatedAt }
elseif cart.currency ~= currency then
  return -2
end

-- Every committed line must be covered by the single pre-mutation Catalog batch.
local validatedIds = {}
for _, id in ipairs(cjson.decode(ARGV[8])) do validatedIds[id] = true end
for _, item in ipairs(cart.items) do
  if not validatedIds[item.variantId] then return -6 end
end

local found = false
for _, item in ipairs(cart.items) do
  if item.variantId == variantId then
    found = true
    if operation == 'add' then
      if item.quantity + quantity > stock then return -3 end
      item.quantity = item.quantity + quantity
    else
      if quantity > stock then return -3 end
      item.quantity = quantity
    end
  end
end

if operation == 'update' and not found then return -4 end
if operation == 'add' and not found then
  if #cart.items >= 100 then return -5 end
  if quantity > stock then return -3 end
  table.insert(cart.items, { variantId = variantId, quantity = quantity })
end
cart.updatedAt = updatedAt
local persisted = cjson.encode(cart)
redis.call('SET', key, persisted, 'EX', ttl)
return persisted
`;

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
    let serialized: string | null;
    try {
      serialized = await this.redis.get(this.key(userId));
    } catch {
      throw new CartStorageUnavailableException();
    }
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
    try {
      await this.redis.set(this.key(userId), JSON.stringify(persisted), { EX: CART_TTL_SECONDS });
    } catch {
      throw new CartStorageUnavailableException();
    }
  }

  async deleteCart(userId: string): Promise<void> {
    try {
      await this.redis.del(this.key(userId));
    } catch {
      throw new CartStorageUnavailableException();
    }
  }

  async mutateCart(userId: string, mutation: CartMutation): Promise<PersistedCart | number> {
    const args = mutation.operation === 'clear'
      ? ['clear', '', '0', '', '0', '0', '']
      : mutation.operation === 'remove'
        ? ['remove', mutation.variantId, '0', '', '0', '2592000', mutation.updatedAt]
        : [
            mutation.operation,
            mutation.variantId,
            String(mutation.quantity),
            mutation.currency,
            String(mutation.stock),
            '2592000',
            mutation.updatedAt,
            JSON.stringify(mutation.validatedIds),
          ];
    try {
      const result = await this.redis.eval(CART_MUTATION_SCRIPT, {
        keys: [this.key(userId)],
        arguments: args,
      });
      if (typeof result === 'number') return result;
      const persisted: unknown = JSON.parse(result as string);
      if (!isPersistedCart(persisted)) throw new Error('Invalid persisted cart');
      return persisted;
    } catch {
      throw new CartStorageUnavailableException();
    }
  }

  private key(userId: string): string {
    return `cart:${userId}`;
  }
}
