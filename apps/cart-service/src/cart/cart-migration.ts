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
if not valid or type(cart) ~= 'table' then return -2 end
if type(cart.currency) ~= 'string' or not string.match(cart.currency, '^[A-Z][A-Z][A-Z]$') then return -2 end
local function validTimestamp(value)
  if type(value) ~= 'string' or not string.match(value,
    '^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%dZ$') then return false end
  local year, month, day = tonumber(string.sub(value,1,4)), tonumber(string.sub(value,6,7)), tonumber(string.sub(value,9,10))
  local hour, minute, second = tonumber(string.sub(value,12,13)), tonumber(string.sub(value,15,16)), tonumber(string.sub(value,18,19))
  if year < 1 or month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
  local days = {31,28,31,30,31,30,31,31,30,31,30,31}
  if month == 2 and year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0) then days[2] = 29 end
  return day >= 1 and day <= days[month]
end
if not validTimestamp(cart.updatedAt) then return -2 end
if type(cart.items) ~= 'table' or #cart.items < 1 or #cart.items > 100 then return -2 end
local seen = {}
for key, item in pairs(cart.items) do
  if type(key) ~= 'number' or key < 1 or key > #cart.items or key ~= math.floor(key) or type(item) ~= 'table' then return -2 end
  local id = item.variantId
  if type(id) ~= 'string' or #id ~= 36 or string.sub(id,9,9) ~= '-' or
     string.sub(id,14,14) ~= '-' or string.sub(id,19,19) ~= '-' or
     string.sub(id,24,24) ~= '-' or string.sub(id,15,15) ~= '4' or
     not string.match(string.sub(id,20,20), '^[89aAbB]$') or
     not string.match(string.gsub(id, '-', ''), '^[%x]+$') or seen[string.lower(id)] then return -2 end
  seen[string.lower(id)] = true
  local quantity = item.quantity
  if type(quantity) ~= 'number' or quantity < 1 or quantity > 9007199254740991 or
     quantity ~= math.floor(quantity) then return -2 end
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
