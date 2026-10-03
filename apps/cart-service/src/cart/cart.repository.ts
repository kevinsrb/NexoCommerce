import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CartDomainException, CartStorageUnavailableException } from '../common/cart-domain.exception';

export interface PersistedCart {
  currency: string;
  items: Array<{ variantId: string; quantity: number }>;
  updatedAt: string;
}

export interface CartCheckoutSnapshot {
  version: number;
  lines: Array<{ variantId: string; quantity: number }>;
}

const CART_TTL_SECONDS = 2_592_000;

const isPersistedCart = (value: unknown): value is PersistedCart => {
  if (typeof value !== 'object' || value === null) return false;
  const cart = value as Record<string, unknown>;
  return typeof cart.currency === 'string' && /^[A-Z]{3}$/.test(cart.currency) &&
    Array.isArray(cart.items) && cart.items.length <= 100 &&
    cart.items.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const line = item as Record<string, unknown>;
      return typeof line.variantId === 'string' && Number.isSafeInteger(line.quantity) &&
        (line.quantity as number) >= 1;
    }) && typeof cart.updatedAt === 'string' && Number.isFinite(Date.parse(cart.updatedAt));
};

export interface CartRedisClient {
  isOpen: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export type CartMutation =
  | { operation: 'add'; variantId: string; quantity: number; currency: string; stock: number; updatedAt: string; validatedIds: string[] }
  | { operation: 'update'; variantId: string; quantity: number; currency: string; stock: number; updatedAt: string; validatedIds: string[] }
  | { operation: 'remove'; variantId: string; updatedAt: string }
  | { operation: 'clear' };

type ScriptResult = { status: string; version?: number; cart?: PersistedCart | null };

// All reads and writes serialize against the same three principal-scoped keys.
export const CART_STATE_SCRIPT = `
local dataKey, versionKey, claimKey = KEYS[1], KEYS[2], KEYS[3]
local operation = ARGV[1]
local raw = redis.call('GET', dataKey)
local versionRaw = redis.call('GET', versionKey)
local claimRaw = redis.call('GET', claimKey)
if not versionRaw then
  if raw or claimRaw then return cjson.encode({status='integrity'}) end
  redis.call('SET', versionKey, '0')
  versionRaw = '0'
end
local version = tonumber(versionRaw)
if not version or version < 0 or version >= 9007199254740991 or version ~= math.floor(version) then
  return cjson.encode({status='integrity'})
end
local cart = raw and cjson.decode(raw) or nil
local claim = claimRaw and cjson.decode(claimRaw) or nil
if claim and claim.status == 'active' and not cart then return cjson.encode({status='integrity'}) end
local function result(status, value)
  return cjson.encode({status=status, version=version, cart=value or cjson.null})
end
if operation == 'read' then return result('ok', cart) end
if operation == 'read_mutable' then
  if claim and claim.status == 'active' then return result('claimed', cart) end
  return result('ok', cart)
end

if operation == 'claim' then
  local attempt, expected = ARGV[2], tonumber(ARGV[3])
  if claim and claim.status == 'active' then
    if claim.attemptId == attempt and claim.version == expected then return result('ok', cart) end
    return result('claimed', cart)
  end
  local claimId = attempt .. ':' .. ARGV[3]
  if expected ~= version or (claim and claim.history and claim.history[claimId]) then
    return result('version_changed', cart)
  end
  if not cart or not cart.items or #cart.items == 0 then return result('not_found', cart) end
  redis.call('SET', claimKey, cjson.encode({
    attemptId=attempt, version=version, status='active', history=claim and claim.history or {}
  }))
  redis.call('PERSIST', dataKey)
  return result('ok', cart)
end

if operation == 'complete' or operation == 'release' then
  local attempt, expected, ttl = ARGV[2], tonumber(ARGV[3]), tonumber(ARGV[4])
  local claimId = attempt .. ':' .. ARGV[3]
  local terminal = claim and claim.history and claim.history[claimId] or nil
  if terminal then
    if terminal.status ~= operation .. 'd' then return result('version_changed', cart) end
    return cjson.encode({status='ok', version=terminal.version, cart=terminal.cart or cjson.null})
  end
  if not claim or claim.attemptId ~= attempt or claim.version ~= expected then
    return result('version_changed', cart)
  end
  if claim.status == operation .. 'd' then
    return cjson.encode({status='ok', version=claim.terminalVersion, cart=claim.terminalCart or cjson.null})
  end
  if claim.status ~= 'active' or version ~= expected or not cart then
    return result('version_changed', cart)
  end
  if operation == 'complete' then
    redis.call('DEL', dataKey)
    version = redis.call('INCR', versionKey)
    cart = nil
    claim.status = 'completed'
  else
    redis.call('EXPIRE', dataKey, ttl)
    claim.status = 'released'
  end
  claim.terminalVersion = version
  claim.terminalCart = cart
  claim.history = claim.history or {}
  claim.history[claimId] = {status=claim.status, version=version, cart=cart}
  redis.call('SET', claimKey, cjson.encode(claim))
  return result('ok', cart)
end

if claim and claim.status == 'active' then return result('claimed', cart) end
if operation == 'clear' then
  if not cart then return result('unchanged', cart) end
  redis.call('DEL', dataKey)
  version = redis.call('INCR', versionKey)
  return result('ok', nil)
end
local variantId, quantity, currency = ARGV[2], tonumber(ARGV[3]), ARGV[4]
local stock, ttl, updatedAt = tonumber(ARGV[5]), tonumber(ARGV[6]), ARGV[7]
if operation == 'remove' then
  if not cart then return result('unchanged', cart) end
  local items, removed = {}, false
  for _, item in ipairs(cart.items) do
    if item.variantId == variantId then removed = true else table.insert(items, item) end
  end
  if not removed then return result('unchanged', cart) end
  if #items == 0 then
    redis.call('DEL', dataKey)
    version = redis.call('INCR', versionKey)
    return result('ok', nil)
  end
  cart.items, cart.updatedAt = items, updatedAt
  redis.call('SET', dataKey, cjson.encode(cart), 'EX', ttl)
  version = redis.call('INCR', versionKey)
  return result('ok', cart)
end
if not cart then
  if operation ~= 'add' then return result('item_not_found', nil) end
  cart = {currency=currency, items={}, updatedAt=updatedAt}
elseif cart.currency ~= currency then return result('currency_mismatch', cart) end
local validated = {}
for _, id in ipairs(cjson.decode(ARGV[8])) do validated[id] = true end
for _, item in ipairs(cart.items) do
  if not validated[item.variantId] then return result('concurrent_modification', cart) end
end
local found = false
for _, item in ipairs(cart.items) do
  if item.variantId == variantId then
    found = true
    if operation == 'add' then
      if item.quantity + quantity > stock then return result('stock', cart) end
      item.quantity = item.quantity + quantity
    else
      if quantity > stock then return result('stock', cart) end
      item.quantity = quantity
    end
  end
end
if operation == 'update' and not found then return result('item_not_found', cart) end
if operation == 'add' and not found then
  if #cart.items >= 100 then return result('too_many', cart) end
  if quantity > stock then return result('stock', cart) end
  table.insert(cart.items, {variantId=variantId, quantity=quantity})
end
cart.updatedAt = updatedAt
redis.call('SET', dataKey, cjson.encode(cart), 'EX', ttl)
version = redis.call('INCR', versionKey)
return result('ok', cart)
`;

@Injectable()
export class CartRepository implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly redis: CartRedisClient) {}

  async onApplicationBootstrap(): Promise<void> { await this.redis.connect(); }
  async onApplicationShutdown(): Promise<void> { if (this.redis.isOpen) await this.redis.quit(); }

  private keys(principalId: string): string[] {
    return [`cart:data:${principalId}`, `cart:version:${principalId}`, `cart:claim:${principalId}`];
  }

  private async execute(principalId: string, args: string[]): Promise<ScriptResult> {
    let raw: unknown;
    try {
      raw = await this.redis.eval(CART_STATE_SCRIPT, { keys: this.keys(principalId), arguments: args });
    } catch {
      throw new CartStorageUnavailableException();
    }
    try {
      const result = JSON.parse(raw as string) as ScriptResult;
      if (!result || typeof result.status !== 'string' ||
        (result.cart != null && !isPersistedCart(result.cart)) ||
        (result.version !== undefined && (!Number.isSafeInteger(result.version) || result.version < 0))) {
        throw new Error('Invalid Cart state');
      }
      if (result.status === 'integrity') throw new Error('Cart version integrity failure');
      return result;
    } catch {
      throw new CartStorageUnavailableException();
    }
  }

  async getCart(principalId: string): Promise<PersistedCart | null> {
    return (await this.execute(principalId, ['read'])).cart ?? null;
  }

  async getMutableCart(principalId: string): Promise<PersistedCart | null> {
    const result = await this.execute(principalId, ['read_mutable']);
    if (result.status === 'claimed') {
      throw new CartDomainException('CART_CHECKOUT_IN_PROGRESS', 'Cart checkout in progress', 409);
    }
    if (result.status !== 'ok') throw new CartStorageUnavailableException();
    return result.cart ?? null;
  }

  async readCheckoutSnapshot(principalId: string): Promise<CartCheckoutSnapshot> {
    return this.snapshot(await this.execute(principalId, ['read']));
  }

  async claimCheckout(principalId: string, attemptId: string, expectedVersion: number): Promise<CartCheckoutSnapshot> {
    return this.snapshot(await this.execute(principalId, ['claim', attemptId, String(expectedVersion)]));
  }

  async completeCheckout(principalId: string, attemptId: string, version: number): Promise<CartCheckoutSnapshot> {
    return this.snapshot(await this.execute(principalId, ['complete', attemptId, String(version), String(CART_TTL_SECONDS)]));
  }

  async releaseCheckout(principalId: string, attemptId: string, version: number): Promise<CartCheckoutSnapshot> {
    return this.snapshot(await this.execute(principalId, ['release', attemptId, String(version), String(CART_TTL_SECONDS)]));
  }

  private snapshot(result: ScriptResult): CartCheckoutSnapshot {
    if (result.status === 'not_found') throw new CartDomainException('CART_NOT_FOUND', 'Cart not found', 404);
    if (result.status === 'version_changed') throw new CartDomainException('CART_VERSION_CHANGED', 'Cart version changed', 409);
    if (result.status === 'claimed') throw new CartDomainException('CART_CHECKOUT_IN_PROGRESS', 'Cart checkout in progress', 409);
    if (result.status !== 'ok' || result.version === undefined) throw new CartStorageUnavailableException();
    return { version: result.version, lines: result.cart?.items.map(({ variantId, quantity }) => ({ variantId, quantity })) ?? [] };
  }

  async mutateCart(principalId: string, mutation: CartMutation): Promise<PersistedCart | number> {
    const args = mutation.operation === 'clear'
      ? ['clear']
      : mutation.operation === 'remove'
        ? ['remove', mutation.variantId, '0', '', '0', String(CART_TTL_SECONDS), mutation.updatedAt]
        : [mutation.operation, mutation.variantId, String(mutation.quantity), mutation.currency,
          String(mutation.stock), String(CART_TTL_SECONDS), mutation.updatedAt, JSON.stringify(mutation.validatedIds)];
    const result = await this.execute(principalId, args);
    const errors: Record<string, number> = {
      currency_mismatch: -2, stock: -3, item_not_found: -4, too_many: -5,
      concurrent_modification: -6, claimed: -7,
    };
    if (result.status in errors) return errors[result.status];
    if (result.status === 'unchanged' || mutation.operation === 'clear' || mutation.operation === 'remove') return 0;
    if (result.status === 'ok' && result.cart) return result.cart;
    throw new CartStorageUnavailableException();
  }
}
