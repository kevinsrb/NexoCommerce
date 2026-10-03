import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type InternalCatalogVariant } from '@nexo/contracts';
import { AppModule } from '../src/app.module';
import { CART_REDIS_CLIENT } from '../src/cart/cart.module';
import { CART_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { configureHttpApp } from '../src/common/http';

export const userId = '550e8400-e29b-41d4-a716-446655440000';
export const variantId = '550e8400-e29b-41d4-a716-446655440001';
export const otherId = '550e8400-e29b-41d4-a716-446655440002';
export const missingId = '550e8400-e29b-41d4-a716-446655440003';
export const requestId = '550e8400-e29b-41d4-a716-446655440004';
const secret = 'access-secret-at-least-thirty-two-characters';
const catalogInternalToken = 'catalog-internal-token-at-least-32-characters';
const cartInternalToken = 'cart-internal-token-at-least-32-characters';
export const emptyCart = { currency: null, items: [], total: '0.00', itemCount: 0 };

export class CartHarness {
  app!: NestExpressApplication;
  server!: Server;
  values = new Map<string, string>();
  writes: Array<{ key: string; value: string; ttl: number }> = [];
  deletes: string[] = [];
  calls: Array<{
    url: string | undefined;
    method: string | undefined;
    ids: string[];
    requestId: string | string[] | undefined;
  }> = [];
  mode: 'ok' | 'status' | 'json' | 'shape' | 'row' | 'interrupted' | 'timeout' | 'body-timeout' =
    'ok';
  storageFailure = false;
  beforeMutation?: () => void;
  afterMutation?: () => void;
  variants: InternalCatalogVariant[] = [];
  readonly cartInternalToken = cartInternalToken;
  reset(): void {
    this.values.clear();
    this.writes = [];
    this.deletes = [];
    this.calls = [];
    this.mode = 'ok';
    this.storageFailure = false;
    this.beforeMutation = undefined;
    this.afterMutation = undefined;
    this.variants = [variantId, otherId].map((id) => ({
      id,
      productId: userId,
      productName: 'Product',
      variantName: 'Variant',
      price: '0.10',
      currency: 'USD',
      stock: 20,
      productActive: true,
      variantActive: true,
    }));
  }
  token(
    payload: Record<string, unknown> = { sub: userId, type: 'access' },
    signingSecret = secret,
  ): string {
    return new JwtService().sign(payload, { secret: signingSecret, expiresIn: '5m' });
  }
  stored(): unknown {
    const value = this.values.get(`cart:data:${userId}`);
    return value ? JSON.parse(value) : null;
  }
  async start(): Promise<void> {
    this.reset();
    this.server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { ids } = JSON.parse(body) as { ids: string[] };
      if (req.headers['x-internal-service-token'] !== catalogInternalToken) {
        res.writeHead(401).end();
        return;
      }
      this.calls.push({
        url: req.url,
        method: req.method,
        ids,
        requestId: req.headers['x-request-id'],
      });
      if (this.mode === 'timeout') return;
      if (this.mode === 'body-timeout') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('[');
        return;
      }
      if (this.mode === 'status') {
        res.writeHead(500).end('private upstream error');
        return;
      }
      if (this.mode === 'interrupted') {
        res.writeHead(200, { 'Content-Length': 999 });
        res.write('[{');
        setImmediate(() => res.destroy());
        return;
      }
      if (this.mode === 'json') {
        res.end('{');
        return;
      }
      if (this.mode === 'shape') {
        res.end('{}');
        return;
      }
      if (this.mode === 'row') {
        res.end('[{"id":"bad","price":"NaN"}]');
        return;
      }
      if (!ids.length || ids.length > 100) {
        res.writeHead(400).end('{}');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      // PostgreSQL UUID lookup accepts alternate casing and returns canonical lowercase IDs.
      const canonicalIds = ids.map((id) => id.toLowerCase());
      res.end(JSON.stringify(this.variants.filter((variant) => canonicalIds.includes(variant.id))));
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CART_ENVIRONMENT)
      .useValue(
        parseEnvironment({
          REDIS_URL: 'redis://localhost:6379',
          CATALOG_SERVICE_URL: `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`,
          JWT_ACCESS_SECRET: secret,
          CATALOG_INTERNAL_TOKEN: catalogInternalToken,
          CART_INTERNAL_SERVICE_TOKEN: cartInternalToken,
        }),
      )
      .overrideProvider(CART_REDIS_CLIENT)
      .useValue({
        isOpen: false,
        connect: async () => undefined,
        quit: async () => undefined,
         get: async (key: string) => {
           if (this.storageFailure) throw new Error('private redis failure');
           return this.values.get(key) ?? null;
         },
         set: async (key: string, value: string, options: { EX: number }) => {
           if (this.storageFailure) throw new Error('private redis failure');
           this.values.set(key, value);
          this.writes.push({ key, value, ttl: options.EX });
        },
         del: async (key: string) => {
           if (this.storageFailure) throw new Error('private redis failure');
           this.values.delete(key);
          this.deletes.push(key);
        },
        eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
          if (this.storageFailure) throw new Error('private redis failure');
          const [operation, variantId, quantityValue, currency, stockValue, ttlValue, updatedAt, validatedIdsValue] = options.arguments;
          const [key, versionKey, claimKey] = options.keys;
          if (operation !== 'read') this.beforeMutation?.();
          const current = this.values.get(key);
          let cart = current ? JSON.parse(current) as {
            currency: string;
            items: Array<{ variantId: string; quantity: number }>;
            updatedAt: string;
          } : null;
          const claimValue = this.values.get(claimKey);
          const claim = claimValue ? JSON.parse(claimValue) as {
            attemptId: string; version: number; status: string; terminalVersion?: number;
            terminalCart?: typeof cart;
            history?: Record<string, { status: string; version: number; cart: typeof cart }>;
          } : null;
          let version = this.values.get(versionKey);
          if (version === undefined) {
            if (cart || claim) return JSON.stringify({ status: 'integrity' });
            version = '0';
            this.values.set(versionKey, version);
          }
          if (claim?.status === 'active' && !cart) return JSON.stringify({ status: 'integrity' });
          const reply = (status: string) => JSON.stringify({ status, version: Number(version), cart });
          const advance = () => { version = String(Number(version) + 1); this.values.set(versionKey, version); };
          const write = (next: typeof cart, ttl: number) => {
            if (next) {
              const value = JSON.stringify(next);
              this.values.set(key, value);
              this.writes.push({ key, value, ttl });
            } else {
              this.values.delete(key);
              this.deletes.push(key);
            }
            cart = next;
            advance();
            this.afterMutation?.();
          };
          if (operation === 'read') return reply('ok');
          if (operation === 'claim') {
            const expected = Number(quantityValue);
            if (claim?.status === 'active') return reply(claim.attemptId === variantId && claim.version === expected ? 'ok' : 'claimed');
            if (expected !== Number(version) || claim?.history?.[`${variantId}:${quantityValue}`]) return reply('version_changed');
            if (!cart?.items.length) return reply('not_found');
            this.values.set(claimKey, JSON.stringify({
              attemptId: variantId, version: expected, status: 'active', history: claim?.history ?? {},
            }));
            return reply('ok');
          }
          if (operation === 'complete' || operation === 'release') {
            const expected = Number(quantityValue);
            const terminal = claim?.history?.[`${variantId}:${quantityValue}`];
            if (terminal) return terminal.status === `${operation}d`
              ? JSON.stringify({ status: 'ok', version: terminal.version, cart: terminal.cart })
              : reply('version_changed');
            if (!claim || claim.attemptId !== variantId || claim.version !== expected) return reply('version_changed');
            if (claim.status === `${operation}d`) return JSON.stringify({
              status: 'ok', version: claim.terminalVersion, cart: claim.terminalCart ?? null,
            });
            if (claim.status !== 'active' || expected !== Number(version) || !cart) return reply('version_changed');
            if (operation === 'complete') write(null, Number(ttlValue));
            this.values.set(claimKey, JSON.stringify({
              ...claim, status: `${operation}d`, terminalVersion: Number(version), terminalCart: cart,
              history: { ...claim.history, [`${variantId}:${quantityValue}`]: {
                status: `${operation}d`, version: Number(version), cart,
              } },
            }));
            return reply('ok');
          }
          if (claim?.status === 'active') return reply('claimed');
          if (operation === 'clear') {
            if (!cart) return reply('unchanged');
            write(null, 0);
            return reply('ok');
          }
          if (operation === 'remove') {
            if (!cart) return reply('unchanged');
            const items = cart.items.filter((item) => item.variantId !== variantId);
            if (items.length === cart.items.length) return reply('unchanged');
            if (!items.length) {
              write(null, 0);
              return reply('ok');
            }
            const next = { ...cart, items, updatedAt };
            write(next, Number(ttlValue));
            return reply('ok');
          }
          const quantity = Number(quantityValue);
          const stock = Number(stockValue);
          if (!cart) {
            if (operation !== 'add') return reply('item_not_found');
          } else if (cart.currency !== currency) return reply('currency_mismatch');
          const next = cart ?? { currency, items: [], updatedAt };
          const validatedIds = JSON.parse(validatedIdsValue) as string[];
          if (next.items.some((item) => !validatedIds.includes(item.variantId))) return reply('concurrent_modification');
          const existing = next.items.find((item) => item.variantId === variantId);
          if (operation === 'update' && !existing) return reply('item_not_found');
          if (operation === 'add') {
            if (existing) {
              if (existing.quantity + quantity > stock) return reply('stock');
              existing.quantity += quantity;
            } else {
              if (next.items.length >= 100) return reply('too_many');
              if (quantity > stock) return reply('stock');
              next.items.push({ variantId, quantity });
            }
          } else {
            if (quantity > stock) return reply('stock');
            existing!.quantity = quantity;
          }
          next.updatedAt = updatedAt;
          write(next, Number(ttlValue));
          return reply('ok');
        },
      })
      .compile();
    this.app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(this.app);
    await this.app.init();
  }
  async close(): Promise<void> {
    await this.app?.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
