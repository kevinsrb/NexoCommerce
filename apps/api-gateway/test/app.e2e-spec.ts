import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureHttpApp, configureSwagger } from '../src/main';

describe('API gateway HTTP boundary', () => {
  let app: NestExpressApplication;
  const originalAuthServiceUrl = process.env.AUTH_SERVICE_URL;
  const originalCatalogServiceUrl = process.env.CATALOG_SERVICE_URL;
  const originalCartServiceUrl = process.env.CART_SERVICE_URL;

  beforeAll(async () => {
    process.env.AUTH_SERVICE_URL = 'http://auth.internal.test';
    process.env.CATALOG_SERVICE_URL = 'http://catalog.internal.test';
    process.env.CART_SERVICE_URL = 'http://cart.internal.test';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    configureSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalAuthServiceUrl === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = originalAuthServiceUrl;
    if (originalCatalogServiceUrl === undefined) delete process.env.CATALOG_SERVICE_URL;
    else process.env.CATALOG_SERVICE_URL = originalCatalogServiceUrl;
    if (originalCartServiceUrl === undefined) delete process.env.CART_SERVICE_URL;
    else process.env.CART_SERVICE_URL = originalCartServiceUrl;
  });

  it('returns the gateway health response with a request ID', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: 'api-gateway' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('adds a request ID to CORS preflight responses', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/health')
      .set('origin', 'https://storefront.example')
      .set('access-control-request-method', 'GET')
      .expect(204);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('hosts Swagger under the public API prefix', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('Swagger UI');
    await request(app.getHttpServer()).get('/docs').expect(404);
  });

  it('documents the public Auth, Catalog, and Cart proxy routes without Catalog internal routes', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);

    expect(response.body.paths).toEqual(
      expect.objectContaining({
        '/api/auth/login': expect.objectContaining({ post: expect.any(Object) }),
        '/api/products': expect.objectContaining({ get: expect.any(Object) }),
        '/api/categories': expect.objectContaining({ get: expect.any(Object) }),
        '/api/cart': expect.objectContaining({ get: expect.any(Object), delete: expect.any(Object) }),
        '/api/cart/items': expect.objectContaining({ post: expect.any(Object) }),
        '/api/cart/items/{variantId}': expect.objectContaining({
          patch: expect.any(Object),
          delete: expect.any(Object),
        }),
      }),
    );
    expect(response.body.paths['/api/internal/variants/batch']).toBeUndefined();
  });

  it('does not route Catalog internal endpoints through the public gateway', async () => {
    await request(app.getHttpServer()).post('/api/internal/variants/batch').send({}).expect(404);
  });

  it('returns a safe 413 error for an oversized JSON request body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/health')
      .send({ privateDetails: 'secret'.repeat(20_000) })
      .expect(413);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body).toEqual({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Payload too large',
      requestId: response.headers['x-request-id'],
    });
  });

  it('formats malformed JSON as a public API error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Bad request',
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
  });
});
