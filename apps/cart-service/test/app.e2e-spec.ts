import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/http';
import { CART_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { CartRepository } from '../src/cart/cart.repository';

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
