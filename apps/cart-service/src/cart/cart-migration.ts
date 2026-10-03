export interface MigrationRedisClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

// Run with Phase 2 Cart writes stopped. RENAME retains the payload's remaining TTL.
export const CART_MIGRATION_SCRIPT = `
local legacy, data, version, claim = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local raw = redis.call('GET', legacy)
if not raw then return 0 end
if redis.call('EXISTS', data, version, claim) ~= 0 then return -1 end
local valid, cart = pcall(cjson.decode, raw)
if not valid or type(cart) ~= 'table' or type(cart.items) ~= 'table' or
   type(cart.currency) ~= 'string' or type(cart.updatedAt) ~= 'string' then
  return -2
end
redis.call('RENAME', legacy, data)
redis.call('SET', version, '1')
return 1
`;

export async function migrateLegacyCart(
  redis: MigrationRedisClient,
  principalId: string,
): Promise<'migrated' | 'absent'> {
  const result = await redis.eval(CART_MIGRATION_SCRIPT, {
    keys: [`cart:${principalId}`, `cart:data:${principalId}`, `cart:version:${principalId}`, `cart:claim:${principalId}`],
    arguments: [],
  });
  if (result === 1) return 'migrated';
  if (result === 0) return 'absent';
  if (result === -1) throw new Error(`Cart migration conflict for ${principalId}`);
  if (result === -2) throw new Error(`Invalid legacy Cart payload for ${principalId}`);
  throw new Error(`Unexpected Cart migration result for ${principalId}`);
}
