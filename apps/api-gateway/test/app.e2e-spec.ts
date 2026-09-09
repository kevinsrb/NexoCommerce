import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureHttpApp, configureSwagger } from '../src/main';

describe('API gateway HTTP boundary', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
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
