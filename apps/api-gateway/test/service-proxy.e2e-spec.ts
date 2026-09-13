import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureHttpApp, configureSwagger } from '../src/main';

type ReceivedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
};

const listen = (server: Server): Promise<string> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

const captureRequest = async (request: IncomingMessage): Promise<ReceivedRequest> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    body: Buffer.concat(chunks).toString('utf8'),
  };
};

const json = (response: ServerResponse, statusCode: number, body: unknown, requestId?: string) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...(requestId ? { 'x-request-id': requestId } : {}),
  });
  response.end(JSON.stringify(body));
};

describe('API Gateway service proxy', () => {
  let app: NestExpressApplication;
  let authServer: Server;
  let catalogServer: Server;
  let authRequests: ReceivedRequest[];
  let catalogRequests: ReceivedRequest[];
  const originalAuthServiceUrl = process.env.AUTH_SERVICE_URL;
  const originalCatalogServiceUrl = process.env.CATALOG_SERVICE_URL;

  beforeAll(async () => {
    authRequests = [];
    catalogRequests = [];
    authServer = createServer(async (incoming, outgoing) => {
      const received = await captureRequest(incoming);
      authRequests.push(received);
      if (received.body.includes('broken-body@example.com')) {
        outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        outgoing.flushHeaders();
        outgoing.write('{"partial":');
        setTimeout(() => outgoing.destroy(), 25);
        return;
      }
      json(
        outgoing,
        200,
        { accessToken: 'access-token', refreshToken: 'refresh-token' },
        typeof received.headers['x-request-id'] === 'string'
          ? received.headers['x-request-id']
          : undefined,
      );
    });
    catalogServer = createServer(async (incoming, outgoing) => {
      const received = await captureRequest(incoming);
      catalogRequests.push(received);
      json(
        outgoing,
        200,
        [
          {
            id: '3076e554-7586-4deb-b2c9-8e4e29e041d8',
            name: 'Gateway Product',
            slug: 'gateway-product',
            description: 'Catalog response forwarded through the gateway.',
            active: true,
            category: {
              id: '0c1b3c55-bdd5-4467-8c86-1538229d18d3',
              name: 'Test',
              slug: 'test',
            },
            variants: [],
          },
        ],
        typeof received.headers['x-request-id'] === 'string'
          ? received.headers['x-request-id']
          : undefined,
      );
    });

    process.env.AUTH_SERVICE_URL = await listen(authServer);
    process.env.CATALOG_SERVICE_URL = await listen(catalogServer);

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    configureSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (authServer.listening) await close(authServer);
    if (catalogServer.listening) await close(catalogServer);
    if (originalAuthServiceUrl === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = originalAuthServiceUrl;
    if (originalCatalogServiceUrl === undefined) delete process.env.CATALOG_SERVICE_URL;
    else process.env.CATALOG_SERVICE_URL = originalCatalogServiceUrl;
  });

  it('forwards Auth requests and preserves the inbound request ID', async () => {
    const requestId = 'e85aa02d-8090-42c6-83ce-c3bac6278c32';

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('x-request-id', requestId)
      .send({ email: 'customer@example.com', password: 'correct-horse-battery-staple' })
      .expect(200);

    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    expect(authRequests).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/auth/login',
        headers: expect.objectContaining({ 'x-request-id': requestId }),
        body: JSON.stringify({ email: 'customer@example.com', password: 'correct-horse-battery-staple' }),
      }),
    ]);
  });

  it('forwards Product requests and preserves their query string', async () => {
    const response = await request(app.getHttpServer()).get('/api/products?limit=1&offset=0').expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({ slug: 'gateway-product' }),
    ]);
    expect(catalogRequests).toEqual([
      expect.objectContaining({ method: 'GET', url: '/products?limit=1&offset=0' }),
    ]);
  });

  it('returns a safe public response when an internal response body is interrupted', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'broken-body@example.com', password: 'correct-horse-battery-staple' })
      .expect(503);

    expect(response.body).toEqual({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Internal service unavailable',
      requestId: response.headers['x-request-id'],
    });
  });

  it('returns a safe public response when an internal service is unavailable', async () => {
    await close(authServer);

    const response = await request(app.getHttpServer()).post('/api/auth/login').send({}).expect(503);

    expect(response.body).toEqual({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Internal service unavailable',
      requestId: response.headers['x-request-id'],
    });
  });
});
