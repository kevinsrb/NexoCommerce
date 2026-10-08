import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CATALOG_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { configureHttpApp } from '../src/common/http';

const internalToken = 'catalog-outage-internal-secret-at-least-32';
const id = '550e8400-e29b-41d4-a716-446655440002';

describe('Catalog HTTP with an unavailable real PostgreSQL dependency', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CATALOG_ENVIRONMENT)
      .useValue(parseEnvironment({
        DATABASE_URL: 'postgresql://outage:private-password@127.0.0.1:1/catalog?connect_timeout=1',
        JWT_ACCESS_SECRET: 'catalog-outage-access-secret-at-least-32',
        CATALOG_ADMIN_SECRET: 'catalog-outage-admin-secret-at-least-32',
        CATALOG_INTERNAL_TOKEN: internalToken,
        NODE_ENV: 'test',
      }))
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it.each([
    `/internal/v1/variants/${id}`,
    `/internal/v1/reservations/by-attempt/${id}`,
  ])('returns a sanitized correlated 503 for GET %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path)
      .set('x-internal-service-token', internalToken)
      .set('x-request-id', id)
      .expect(503);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.body).toEqual({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Dependency unavailable',
      request_id: id,
    });
  });
});
