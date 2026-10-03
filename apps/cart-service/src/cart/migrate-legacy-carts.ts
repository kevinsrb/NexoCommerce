import 'dotenv/config';
import { createClient } from 'redis';
import { migrateLegacyCart } from './cart-migration';

const principalPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
  const redis = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
  await redis.connect();
  let migrated = 0;
  try {
    let cursor = 0;
    do {
      const page = await redis.scan(cursor, { MATCH: 'cart:*', COUNT: 500 });
      cursor = page.cursor;
      for (const key of page.keys) {
        if (!key.startsWith('cart:')) continue;
        const principalId = key.slice(5);
        if (!principalPattern.test(principalId)) continue;
        if (await migrateLegacyCart(redis, principalId) === 'migrated') migrated++;
      }
    } while (cursor !== 0);
    process.stdout.write(`Migrated ${migrated} legacy carts\n`);
  } finally {
    await redis.quit();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Cart migration failed'}\n`);
  process.exitCode = 1;
});
