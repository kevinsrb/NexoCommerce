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
    const value = this.values.get(`cart:${userId}`);
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
          this.beforeMutation?.();
          const [operation, variantId, quantityValue, currency, stockValue, ttlValue, updatedAt, validatedIdsValue] = options.arguments;
          const key = options.keys[0];
          const current = this.values.get(key);
          const cart = current ? JSON.parse(current) as {
            currency: string;
            items: Array<{ variantId: string; quantity: number }>;
            updatedAt: string;
          } : null;
          if (operation === 'clear') {
            this.values.delete(key);
            this.deletes.push(key);
            return 1;
          }
          if (operation === 'remove') {
            if (!cart) return 0;
            const items = cart.items.filter((item) => item.variantId !== variantId);
            if (items.length === cart.items.length) return 0;
            if (!items.length) {
              this.values.delete(key);
              this.deletes.push(key);
              return 1;
            }
            const next = { ...cart, items, updatedAt };
            this.values.set(key, JSON.stringify(next));
            this.writes.push({ key, value: JSON.stringify(next), ttl: Number(ttlValue) });
            return 1;
          }
          const quantity = Number(quantityValue);
          const stock = Number(stockValue);
          if (!cart) {
            if (operation !== 'add') return -4;
          } else if (cart.currency !== currency) return -2;
          const next = cart ?? { currency, items: [], updatedAt };
          const validatedIds = JSON.parse(validatedIdsValue) as string[];
          if (next.items.some((item) => !validatedIds.includes(item.variantId))) return -6;
          const existing = next.items.find((item) => item.variantId === variantId);
          if (operation === 'update' && !existing) return -4;
          if (operation === 'add') {
            if (existing) {
              if (existing.quantity + quantity > stock) return -3;
              existing.quantity += quantity;
            } else {
              if (next.items.length >= 100) return -5;
              if (quantity > stock) return -3;
              next.items.push({ variantId, quantity });
            }
          } else {
            if (quantity > stock) return -3;
            existing!.quantity = quantity;
          }
          next.updatedAt = updatedAt;
          const value = JSON.stringify(next);
          this.values.set(key, value);
          this.writes.push({ key, value, ttl: Number(ttlValue) });
          this.afterMutation?.();
          return value;
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
