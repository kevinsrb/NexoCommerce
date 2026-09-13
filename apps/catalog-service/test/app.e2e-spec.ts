import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '../generated/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/http';
import { CATALOG_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { PrismaService } from '../src/prisma/prisma.service';

const productId = '550e8400-e29b-41d4-a716-446655440000';
const categoryId = '550e8400-e29b-41d4-a716-446655440001';
const variantId = '550e8400-e29b-41d4-a716-446655440002';
const timestamp = new Date('2026-09-07T00:00:00Z');
const category = {
  id: categoryId,
  name: 'Coffee',
  slug: 'coffee',
  createdAt: timestamp,
  updatedAt: timestamp,
};
const input = {
  name: 'Roasted coffee',
  slug: 'roasted-coffee',
  description: 'A Colombian roast',
  categoryId,
  variants: [
    { sku: 'COF-250', name: '250 grams', price: '1234567890123456.78', currency: 'COP', stock: 12 },
  ],
};
const row = {
  id: productId,
  name: input.name,
  slug: input.slug,
  description: input.description,
  active: true,
  categoryId,
  category,
  createdAt: timestamp,
  updatedAt: timestamp,
  futureInternalField: 'private',
  variants: [
    {
      id: variantId,
      productId,
      ...input.variants[0],
      price: new Prisma.Decimal('1234567890123456.78'),
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      futureInternalField: 'private',
    },
  ],
};
const publicProduct = {
  id: productId,
  name: 'Roasted coffee',
  slug: 'roasted-coffee',
  description: 'A Colombian roast',
  active: true,
  category: { id: categoryId, name: 'Coffee', slug: 'coffee' },
  variants: [
    {
      id: variantId,
      sku: 'COF-250',
      name: '250 grams',
      price: '1234567890123456.78',
      currency: 'COP',
      stock: 12,
      active: true,
    },
  ],
};

describe('Catalog HTTP through the real service, only Prisma mocked', () => {
  let app: NestExpressApplication;
  const prisma = {
    product: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    category: { create: jest.fn(), findMany: jest.fn() },
  };

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(CATALOG_ENVIRONMENT)
      .useValue(
        parseEnvironment({
          DATABASE_URL: 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db',
          NODE_ENV: 'test',
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

  it('creates a product and nested variants without losing decimal precision or exposing persistence fields', async () => {
    prisma.product.create.mockResolvedValue(row);
    const response = await request(app.getHttpServer()).post('/products').send(input).expect(201);
    expect(response.body).toEqual(publicProduct);
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data.category.connect).toEqual({ id: categoryId });
    expect(data.variants.create[0].price).toBeInstanceOf(Prisma.Decimal);
    expect(data.variants.create[0].price.toFixed(2)).toBe('1234567890123456.78');
  });

  it('retrieves active product details by slug with an explicit category and variant projection', async () => {
    prisma.product.findFirst.mockResolvedValue(row);
    const response = await request(app.getHttpServer()).get('/products/roasted-coffee').expect(200);
    expect(response.body).toEqual(publicProduct);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'roasted-coffee', active: true },
        include: expect.objectContaining({
          variants: expect.objectContaining({ where: { active: true } }),
        }),
      }),
    );
  });

  it('lists active products with bounded pagination and active variants', async () => {
    prisma.product.findMany.mockResolvedValue([row]);
    const response = await request(app.getHttpServer())
      .get('/products?limit=5&offset=10')
      .expect(200);
    expect(response.body).toEqual([publicProduct]);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        take: 5,
        skip: 10,
        include: expect.objectContaining({
          variants: expect.objectContaining({ where: { active: true } }),
        }),
      }),
    );
  });

  it('uses a finite default page and returns an empty collection when there are no products', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    expect((await request(app.getHttpServer()).get('/products').expect(200)).body).toEqual([]);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 }),
    );
  });

  it('returns a consistent 404 for unknown or inactive product details', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get('/products/missing').expect(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Product not found',
      requestId: response.headers['x-request-id'],
    });
  });

  it('patches product metadata without deleting omitted variants', async () => {
    prisma.product.update.mockResolvedValue({ ...row, name: 'New name', active: false });
    const response = await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .send({ name: 'New name', active: false })
      .expect(200);
    expect(response.body).toEqual({ ...publicProduct, name: 'New name', active: false });
    expect(prisma.product.update.mock.calls[0][0].data).not.toHaveProperty('variants');
    expect(prisma.product.update.mock.calls[0][0].where).toEqual({ id: productId });
  });

  it('replaces supplied variants in one atomic nested update and keeps prices decimal', async () => {
    prisma.product.update.mockResolvedValue(row);
    await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .send({ variants: input.variants })
      .expect(200);
    const variants = prisma.product.update.mock.calls[0][0].data.variants;
    expect(variants.deleteMany).toEqual({});
    expect(variants.create[0].price.toFixed(2)).toBe('1234567890123456.78');
  });

  it('creates and lists public categories without timestamps', async () => {
    prisma.category.create.mockResolvedValue(category);
    prisma.category.findMany.mockResolvedValue([category]);
    expect(
      (
        await request(app.getHttpServer())
          .post('/categories')
          .send({ name: 'Coffee', slug: 'coffee' })
          .expect(201)
      ).body,
    ).toEqual({ id: categoryId, name: 'Coffee', slug: 'coffee' });
    expect((await request(app.getHttpServer()).get('/categories').expect(200)).body).toEqual([
      { id: categoryId, name: 'Coffee', slug: 'coffee' },
    ]);
  });

  it.each([
    { price: 19.99 },
    { price: '-1.00' },
    { price: '1.001' },
    { price: '1e3' },
    { price: '12345678901234567.89' },
    { currency: 'cop' },
    { stock: -1 },
    { stock: 0.5 },
    { active: null },
    { sku: '' },
  ])('rejects invalid variant input before persistence: %j', async (variant) => {
    await request(app.getHttpServer())
      .post('/products')
      .send({ ...input, variants: [{ ...input.variants[0], ...variant }] })
      .expect(400);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it.each([
    { name: ' ' },
    { slug: 'Bad Slug' },
    { categoryId: 'bad' },
    { active: null },
    { variants: [] },
    { variants: null },
    { unexpected: 'private' },
  ])('rejects invalid product input: %j', async (override) => {
    await request(app.getHttpServer())
      .post('/products')
      .send({ ...input, ...override })
      .expect(400);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejects nested variant arrays before persistence when creating a product', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .send({ ...input, variants: [[]] })
      .expect(400);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejects nested variant arrays before persistence when patching a product', async () => {
    await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .send({ variants: [[]] })
      .expect(400);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('rejects invalid patches, IDs, pagination, and category fields before persistence', async () => {
    await request(app.getHttpServer())
      .patch('/products/not-a-uuid')
      .send({ active: false })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .send({ name: null })
      .expect(400);
    await request(app.getHttpServer()).patch(`/products/${productId}`).send({}).expect(400);
    await request(app.getHttpServer()).get('/products?limit=101').expect(400);
    await request(app.getHttpServer()).get('/products?offset=-1').expect(400);
    await request(app.getHttpServer()).get('/products?unexpected=1').expect(400);
    await request(app.getHttpServer())
      .post('/categories')
      .send({ name: 'Coffee', slug: 'Bad Slug' })
      .expect(400);
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it.each([
    ['P2002', 409, 'CONFLICT'],
    ['P2003', 400, 'BAD_REQUEST'],
    ['P2025', 404, 'NOT_FOUND'],
  ])('maps database error %s to a safe API error', async (code, statusCode, errorCode) => {
    prisma.product.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('private database detail', {
        code,
        clientVersion: '6.19.0',
      }),
    );
    const response = await request(app.getHttpServer())
      .post('/products')
      .send(input)
      .expect(statusCode as number);
    expect(response.body.code).toBe(errorCode);
    expect(response.body.message).not.toContain('private');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('sanitizes unexpected failures and malformed JSON', async () => {
    prisma.product.findMany.mockRejectedValue(new Error('postgresql://private-password'));
    const failure = await request(app.getHttpServer()).get('/products').expect(500);
    expect(failure.body.message).toBe('Internal server error');
    const malformed = await request(app.getHttpServer())
      .post('/products')
      .set('content-type', 'application/json')
      .send('{"price":')
      .expect(400);
    expect(malformed.body.message).toBe('Bad request');
    expect(malformed.body.requestId).toBe(malformed.headers['x-request-id']);
  });

  it('returns a safe 413 error for an oversized JSON request body', async () => {
    const response = await request(app.getHttpServer())
      .post('/products')
      .set('x-request-id', productId)
      .send({ ...input, description: 'x'.repeat(110_000) })
      .expect(413);
    expect(response.body).toEqual({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Payload too large',
      requestId: productId,
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('serves internal liveness with security headers and request correlation without database access', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', productId)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'catalog-service' });
    expect(response.headers['x-request-id']).toBe(productId);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const invalid = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'unsafe-request-id')
      .expect(200);
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
