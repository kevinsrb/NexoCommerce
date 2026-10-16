import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { ORDERS_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { configureHttpApp } from '../src/common/http';
import { CheckoutService } from '../src/checkout/checkout.service';
import { CheckoutRepository } from '../src/checkout/checkout.repository';

export const databaseUrl = process.env.ORDERS_TEST_DATABASE_URL;
export const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
export const principal = '550e8400-e29b-41d4-a716-446655440000';
export const variant = '550e8400-e29b-41d4-a716-446655440001';
export const requestId = '550e8400-e29b-41d4-a716-446655440002';
export const secret = 'orders-test-access-secret-at-least-32-characters';
export const body = {
  expectedPrices: [{ variantId: variant, price_decimal: '1234567890123456.78', currency: 'COP' }],
};
export function token(
  payload: object = { sub: principal, type: 'access', exp: Math.floor(Date.now() / 1000) + 3600 },
  algorithm = 'HS256',
  key = secret,
) {
  const encoded = [
    Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
  ].join('.');
  return `${encoded}.${createHmac(algorithm === 'HS384' ? 'sha384' : 'sha256', key)
    .update(encoded)
    .digest('base64url')}`;
}

type Reservation = {
  reservationId: string;
  attemptId: string;
  state: string;
  reservedAt: string;
  expiresAt: string;
  boundOrderId: string | null;
  publicationRevision: number | null;
  lines: Array<{
    variantId: string;
    quantity: number;
    unit_price_decimal: string;
    currency: string;
  }>;
};
export async function harness() {
  const schema = `orders_test_${randomUUID().replaceAll('-', '')}`;
  const root = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const migration = readFileSync(
    resolve(__dirname, '../prisma/migrations/20261004000000_checkout/migration.sql'),
    'utf8',
  );
  for (const statement of migration.split('-- statement').filter((s) => s.trim()))
    await db.$executeRawUnsafe(statement);
  const state = {
    version: 7,
    lines: [{ variantId: variant, quantity: 3 }],
    claim: '' as string,
    completed: new Set<string>(),
    reservations: new Map<string, Reservation>(),
    calls: [] as Array<{
      path: string;
      headers: Record<string, string | string[] | undefined>;
      body: Record<string, unknown>;
    }>,
    failAfterReserve: false,
    failAfterPublish: false,
    failComplete: false,
    failClaim: false,
    unavailableStatus: false,
    failRelease: false,
    expireBeforePublish: false,
    price: '1234567890123456.78',
    currency: 'COP',
    sellable: true,
    currencies: new Map<string, string>(),
    reserveError: '',
    holdRead: undefined as Promise<void> | undefined,
    onRead: undefined as (() => void) | undefined,
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const data = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
    const path = req.url!;
    state.calls.push({ path, headers: req.headers, body: data });
    const send = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const error = (code: string, status = 409) =>
      send({ code, message: code, request_id: requestId }, status);
    if (path.includes('/cart/')) {
      if (
        req.headers['x-internal-service-token'] !== 'orders-test-cart-token-at-least-32-characters'
      )
        return error('UNAUTHENTICATED', 401);
      if (path.endsWith('/read')) {
        state.onRead?.();
        await state.holdRead;
        return send({ version: state.version, lines: state.lines });
      }
      const attemptId = data.attemptId as string;
      if (path.endsWith('/checkout-claims')) {
        if (data.expectedVersion !== state.version) return error('CART_VERSION_CHANGED');
        if (state.claim && state.claim !== attemptId) return error('CART_CHECKOUT_IN_PROGRESS');
        state.claim = attemptId;
        if (state.failClaim) {
          state.failClaim = false;
          return req.socket.destroy();
        }
      } else if (path.endsWith('/complete')) {
        if (state.failComplete) return req.socket.destroy();
        if (!state.completed.has(attemptId)) {
          if (state.claim !== attemptId || data.version !== state.version)
            return error('CART_VERSION_CHANGED');
          state.completed.add(attemptId);
          state.claim = '';
          state.lines = [];
          state.version++;
        }
      } else if (state.claim === attemptId) state.claim = '';
      return send({ version: state.version, lines: state.lines });
    }
    if (
      req.headers['x-internal-service-token'] !== 'orders-test-catalog-token-at-least-32-characters'
    )
      return error('UNAUTHENTICATED', 401);
    if (path.includes('/variants/')) {
      const id = path.split('/').pop()!;
      return send({
        variantId: id,
        sellable: state.sellable,
        available: 10,
        price_decimal: state.price,
        currency: state.currencies.get(id) ?? state.currency,
      });
    }
    const attemptId = (data.attemptId ?? path.split('/')[5]) as string;
    let reservation = state.reservations.get(attemptId);
    if (path === '/internal/v1/reservations') {
      if (state.reserveError) return error(state.reserveError);
      if (!reservation) {
        reservation = {
          reservationId: randomUUID(),
          attemptId,
          state: 'ACTIVE',
          reservedAt: '2026-10-08T12:00:00.000Z',
          expiresAt: '2026-10-08T12:15:00.000Z',
          boundOrderId: null,
          publicationRevision: null,
          lines: [
            {
              variantId: variant,
              quantity: 3,
              unit_price_decimal: state.price,
              currency: state.currency,
            },
          ],
        };
        state.reservations.set(attemptId, reservation);
      }
      if (state.failAfterReserve) {
        state.failAfterReserve = false;
        return req.socket.destroy();
      }
    } else {
      if (state.unavailableStatus && req.method === 'GET') return req.socket.destroy();
      if (!reservation) return error('RESERVATION_NOT_FOUND', 404);
      if (path.endsWith('/publish-order')) {
        if (state.expireBeforePublish) {
          reservation.state = 'EXPIRED';
          return error('RESERVATION_EXPIRED');
        }
        reservation.state = 'PUBLISHED';
        reservation.boundOrderId = data.orderId as string;
        reservation.publicationRevision = 2;
        if (state.failAfterPublish) {
          state.failAfterPublish = false;
          return req.socket.destroy();
        }
      } else if (req.method === 'DELETE') {
        if (state.failRelease) return req.socket.destroy();
        reservation.state = 'RELEASED';
      }
    }
    return send(reservation);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  const environment = parseEnvironment({
    DATABASE_URL: url.toString(),
    NODE_ENV: 'test',
    CART_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    CATALOG_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    JWT_ACCESS_SECRET: secret,
    CART_INTERNAL_SERVICE_TOKEN: 'orders-test-cart-token-at-least-32-characters',
    CATALOG_INTERNAL_TOKEN: 'orders-test-catalog-token-at-least-32-characters',
  });
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ORDERS_ENVIRONMENT)
    .useValue(environment)
    .compile();
  const app = fixture.createNestApplication<NestExpressApplication>();
  configureHttpApp(app);
  await app.init();
  return {
    db,
    app,
    state,
    service: app.get(CheckoutService),
    repository: app.get(CheckoutRepository),
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await db.$disconnect();
      await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await root.$disconnect();
    },
  };
}
