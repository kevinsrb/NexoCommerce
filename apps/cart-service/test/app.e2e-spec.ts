import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/http';
import { CART_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { CartRepository } from '../src/cart/cart.repository';
import { CartHarness, emptyCart, requestId, userId, variantId } from './cart-harness';

describe('Cart HTTP boundary', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CART_ENVIRONMENT)
      .useValue(
        parseEnvironment({
          REDIS_URL: 'redis://localhost:6379',
          CATALOG_SERVICE_URL: 'http://localhost:3002',
          JWT_ACCESS_SECRET: 'access-secret-at-least-thirty-two-characters',
          CATALOG_INTERNAL_TOKEN: 'catalog-internal-token-at-least-32-characters',
        }),
      )
      .overrideProvider(CartRepository)
      .useValue({ onApplicationBootstrap: jest.fn(), onApplicationShutdown: jest.fn() })
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => app?.close());

  it('serves public health and propagates a valid request ID', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', id)
      .expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'cart-service' });
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('Authenticated Cart HTTP integration', () => {
  const h = new CartHarness();
  beforeAll(async () => h.start());
  beforeEach(() => h.reset());
  afterAll(async () => h.close());

  it.each(['get', 'post', 'patch', 'delete-item', 'delete'])(
    'requires local JWT validation on %s',
    async (operation) => {
      const http = request(h.app.getHttpServer());
      const call =
        operation === 'get'
          ? http.get('/cart')
          : operation === 'post'
            ? http.post('/cart/items')
            : operation === 'patch'
              ? http.patch(`/cart/items/${variantId}`)
              : operation === 'delete-item'
                ? http.delete(`/cart/items/${variantId}`)
                : http.delete('/cart');
      const response = await call.set('x-request-id', requestId).expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', requestId });
      expect(h.values.size).toBe(0);
      expect(h.calls).toEqual([]);
    },
  );

  it.each([
    { sub: userId, type: 'refresh' },
    { sub: 'invalid', type: 'access' },
    { sub: userId, type: 'access', exp: 1 },
  ])('rejects an invalid token payload %j', async (payload) => {
    const { JwtService } = await import('@nestjs/jwt');
    const token = new JwtService().sign(payload, {
      secret: 'access-secret-at-least-thirty-two-characters',
    });
    await request(h.app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token signed with another secret', async () => {
    await request(h.app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${h.token(undefined, 'wrong-secret')}`)
      .expect(401);
  });

  it('returns the authenticated cart and forwards exactly one existing request ID to Catalog', async () => {
    const response = await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .set('x-request-id', requestId)
      .send({ variantId, quantity: 1 })
      .expect(201);
    expect(response.body.total).toBe('0.10');
    expect(h.calls).toEqual([
      { method: 'POST', url: '/internal/variants/batch', ids: [variantId], requestId },
      { method: 'POST', url: '/internal/variants/batch', ids: [variantId], requestId },
    ]);
    expect(h.values.has(`cart:${userId}`)).toBe(true);
  });

  it('maps Redis failures to a safe storage-unavailable envelope', async () => {
    h.storageFailure = true;
    const response = await request(h.app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${h.token()}`)
      .set('x-request-id', requestId)
      .expect(503);

    expect(response.body).toEqual({
      statusCode: 503,
      code: 'CART_STORAGE_UNAVAILABLE',
      message: 'Cart storage unavailable',
      requestId,
    });
  });

  it('reuses its generated request ID when the incoming ID is invalid', async () => {
    const response = await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .set('x-request-id', 'invalid')
      .send({ variantId, quantity: 1 })
      .expect(201);
    expect(h.calls[0].requestId).toBe(response.headers['x-request-id']);
    expect(h.calls[0].requestId).not.toBe('invalid');
  });

  it.each([0, -1, 1.5, '2', null, 9007199254740992])(
    'rejects invalid quantity %j before mutation',
    async (quantity) => {
      await request(h.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${h.token()}`)
        .send({ variantId, quantity })
        .expect(400);
      expect(h.values.size).toBe(0);
    },
  );

  it('rejects malformed variant IDs and additional input fields', async () => {
    await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .send({ variantId: 'invalid', quantity: 1 })
      .expect(400);
    await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .send({ variantId, quantity: 1, price: '0.01' })
      .expect(400);
    await request(h.app.getHttpServer())
      .patch('/cart/items/invalid')
      .set('Authorization', `Bearer ${h.token()}`)
      .send({ quantity: 1 })
      .expect(400);
  });

  it.each(['status', 'json', 'shape', 'row', 'interrupted', 'timeout', 'body-timeout'] as const)(
    'maps Catalog %s failure to safe 503 without persistence',
    async (mode) => {
      h.mode = mode;
      const start = Date.now();
      const response = await request(h.app.getHttpServer())
        .post('/cart/items')
        .set('Authorization', `Bearer ${h.token()}`)
        .set('x-request-id', requestId)
        .send({ variantId, quantity: 1 })
        .expect(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: 'CATALOG_UNAVAILABLE',
        message: 'Catalog unavailable',
        requestId,
      });
      expect(h.values.size).toBe(0);
      expect(h.calls).toHaveLength(1);
      if (mode === 'timeout' || mode === 'body-timeout') {
        expect(Date.now() - start).toBeGreaterThanOrEqual(4900);
        expect(Date.now() - start).toBeLessThan(7500);
      }
    },
    8000,
  );

  it('keeps carts isolated by locally authenticated subject', async () => {
    await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .send({ variantId, quantity: 1 })
      .expect(201);
    const response = await request(h.app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${h.token({ sub: variantId, type: 'access' })}`)
      .expect(200);
    expect(response.body).toEqual(emptyCart);
  });

  it('maps a refused Catalog connection to the same safe envelope', async () => {
    h.server.closeAllConnections();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
    const response = await request(h.app.getHttpServer())
      .post('/cart/items')
      .set('Authorization', `Bearer ${h.token()}`)
      .set('x-request-id', requestId)
      .send({ variantId, quantity: 1 })
      .expect(503);
    expect(response.body).toEqual({
      statusCode: 503,
      code: 'CATALOG_UNAVAILABLE',
      message: 'Catalog unavailable',
      requestId,
    });
    expect(h.values.size).toBe(0);
  });
});
