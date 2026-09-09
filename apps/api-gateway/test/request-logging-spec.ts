import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLogger } from '@nexo/logger';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { requestCompletionLoggingMiddleware } from '../src/common/http/request-completion-logging.middleware';
import { requestIdMiddleware } from '../src/common/http/request-id.middleware';

it('logs the completed request path without query-carried secrets', async () => {
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
  }
});
