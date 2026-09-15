import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLogger } from '@nexo/logger';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { requestCompletionLoggingMiddleware } from '../src/common/http/request-completion-logging.middleware';
import { requestIdMiddleware } from '../src/common/http/request-id.middleware';

it('logs the completed request path without query-carried secrets', async () => {
  const originalAuthServiceUrl = process.env.AUTH_SERVICE_URL;
  const originalCatalogServiceUrl = process.env.CATALOG_SERVICE_URL;
  const originalCartServiceUrl = process.env.CART_SERVICE_URL;
  process.env.AUTH_SERVICE_URL = 'http://auth.internal.test';
  process.env.CATALOG_SERVICE_URL = 'http://catalog.internal.test';
  process.env.CART_SERVICE_URL = 'http://cart.internal.test';
  const records: unknown[] = [];
  const logger = createLogger('api-gateway', {
    hooks: {
      logMethod(args, method) {
        records.push(args[0]);
        method.apply(this, args);
      },
    },
  });
  const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = fixture.createNestApplication<NestExpressApplication>();
  app.use(requestIdMiddleware);
  app.use(requestCompletionLoggingMiddleware(logger));
  app.setGlobalPrefix('api');
  await app.init();

  try {
    await request(app.getHttpServer()).get('/api/health?token=private-query-secret').expect(200);
    expect(records).toEqual([
      {
        method: 'GET',
        path: '/api/health',
        statusCode: 200,
        duration: expect.any(Number),
      },
    ]);
  } finally {
    await app.close();
    if (originalAuthServiceUrl === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = originalAuthServiceUrl;
    if (originalCatalogServiceUrl === undefined) delete process.env.CATALOG_SERVICE_URL;
    else process.env.CATALOG_SERVICE_URL = originalCatalogServiceUrl;
    if (originalCartServiceUrl === undefined) delete process.env.CART_SERVICE_URL;
    else process.env.CART_SERVICE_URL = originalCartServiceUrl;
  }
});
