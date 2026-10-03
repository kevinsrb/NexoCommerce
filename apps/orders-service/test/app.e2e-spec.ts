import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ORDERS_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { configureHttpApp } from '../src/common/http';

describe('Orders service shell', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ORDERS_ENVIRONMENT)
      .useValue(parseEnvironment({
        DATABASE_URL: 'postgresql://nexo:password@localhost:5432/order_db',
        CART_SERVICE_URL: 'http://localhost:3004',
        CATALOG_SERVICE_URL: 'http://localhost:3002',
        JWT_ACCESS_SECRET: 'orders-access-secret-at-least-32-characters',
        CART_INTERNAL_SERVICE_TOKEN: 'orders-cart-token-at-least-32-characters',
        CATALOG_INTERNAL_TOKEN: 'orders-catalog-token-at-least-32-characters',
        NODE_ENV: 'test',
      }))
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('serves correlated health with security headers and no browser CORS', async () => {
    const requestId = '550e8400-e29b-41d4-a716-446655440000';
    const response = await request(app.getHttpServer())
      .get('/health').set('x-request-id', requestId).set('Origin', 'http://localhost:3000').expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'orders-service' });
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('replaces malformed request IDs', async () => {
    const response = await request(app.getHttpServer()).get('/health').set('x-request-id', 'unsafe').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).not.toBe('unsafe');
  });
});
