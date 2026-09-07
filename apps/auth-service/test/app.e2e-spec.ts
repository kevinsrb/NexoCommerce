import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/http';
import { AUTH_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth HTTP boundary', () => {
  let app: NestExpressApplication;
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn() },
  };
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AUTH_ENVIRONMENT)
      .useValue(
        parseEnvironment({
          DATABASE_URL: 'postgresql://nexo:password@localhost:5432/auth_db',
          JWT_ACCESS_SECRET: 'access-secret-at-least-thirty-two-characters',
          JWT_REFRESH_SECRET: 'refresh-secret-at-least-thirty-two-characters',
        }),
      )
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('serves health without touching persistence and propagates a valid request ID', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', id)
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'auth-service' });
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it('protects /auth/me', async () => {
    const response = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(response.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: expect.any(String),
      requestId: response.headers['x-request-id'],
    });
  });
  it('validates registration fields and rejects privilege injection', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'bad', password: 'short', name: 'Ada' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'ada@example.com',
        password: 'long-enough-password',
        name: 'Ada',
        role: 'admin',
      })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  it('registers through the real service and permits only an access token on /auth/me', async () => {
    const user = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'ada@example.com',
      name: 'Ada',
      createdAt: new Date(),
      updatedAt: new Date(),
      passwordHash: 'never-public',
    };
    prisma.user.create.mockResolvedValue(user);
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: user.email, name: 'Ada', password: 'long-enough-password' })
      .expect(201);
    expect(registered.body.user).not.toHaveProperty('passwordHash');
    prisma.user.findUnique.mockResolvedValue(user);
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${registered.body.refreshToken}`)
      .expect(401);
  });
  it('maps login failures and malformed refresh tokens to 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'missing@example.com', password: 'long-enough-password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'malformed' })
      .expect(401);
  });
  it('sanitizes unexpected persistence failures and malformed JSON', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('private database details'));
    const failure = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'long-enough-password' })
      .expect(500);
    expect(failure.body.message).toBe('Internal server error');
    const malformed = await request(app.getHttpServer())
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send('{"password":')
      .expect(400);
    expect(malformed.body.message).toBe('Bad request');
    expect(malformed.body.requestId).toBe(malformed.headers['x-request-id']);
  });
});
