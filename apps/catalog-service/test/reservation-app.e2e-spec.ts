import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '../generated/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/http';
import { CATALOG_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { ReservationService } from '../src/catalog/reservation.service';
import { ReservationExpiryWorker } from '../src/catalog/reservation-expiry.worker';

// Set CATALOG_TEST_DATABASE_URL to a disposable PostgreSQL database. Every run
// creates its own schema; no existing schema or business data is modified.
const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const accessSecret = 'catalog-reservations-access-secret-at-least-32';
const internalToken = 'catalog-reservations-internal-secret-at-least-32';
const adminSecret = 'catalog-reservations-admin-secret-at-least-32';
const adminId = randomUUID();
const adminToken = new JwtService().sign(
  {
    sub: adminId,
    type: 'access',
    role: 'ADMIN',
    adminProof: createHmac('sha256', adminSecret).update(`${adminId}:ADMIN`).digest('base64url'),
  },
  { secret: accessSecret, expiresIn: '1h' },
);

integration('Catalog reservations with real PostgreSQL transactions', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let root: PrismaClient;
  let productId: string;
  let variantId: string;
  let secondId: string;
  const schema = `catalog_test_${randomUUID().replaceAll('-', '')}`;
  const base = '/internal/v1/reservations';
  const line = (id = variantId, quantity = 2) => ({
    variantId: id,
    quantity,
    expected_price_decimal: '1234567890123456.78',
    expected_currency: 'COP',
  });
  const reserve = (attemptId = randomUUID(), lines = [line()]) =>
    request(app.getHttpServer())
      .post(base)
      .set('x-internal-service-token', internalToken)
      .send({ attemptId, lines });
  const publish = (attempt: string, orderId = randomUUID()) =>
    request(app.getHttpServer())
      .post(`${base}/by-attempt/${attempt}/publish-order`)
      .set('x-internal-service-token', internalToken)
      .send({ orderId });
  const status = (attempt: string) =>
    request(app.getHttpServer())
      .get(`${base}/by-attempt/${attempt}`)
      .set('x-internal-service-token', internalToken);
  const release = (attempt: string) =>
    request(app.getHttpServer())
      .delete(`${base}/by-attempt/${attempt}`)
      .set('x-internal-service-token', internalToken);
  const stock = async (id = variantId) =>
    (
      await db.$queryRawUnsafe<Array<{ onHand: number; reserved: number }>>(
        'SELECT "onHand", "reserved" FROM "ProductVariant" WHERE id = $1::uuid',
        id,
      )
    )[0];
  const expire = (attempt: string) =>
    db.$executeRawUnsafe(
      `UPDATE "StockReservation" SET "expiresAt" = clock_timestamp() - interval '1 second' WHERE "attemptId" = $1::uuid`,
      attempt,
    );

  beforeAll(async () => {
    root = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const initial = readFileSync(
      resolve(__dirname, '../prisma/migrations/20260907000000_init_catalog/migration.sql'),
      'utf8',
    );
    for (const statement of initial.split(';').filter((part) => part.trim()))
      await db.$executeRawUnsafe(statement);
    // A real pre-migration row proves existing stock is preserved as unreserved onHand.
    await db.$executeRawUnsafe(
      `INSERT INTO "Category" (id,name,slug,"updatedAt") VALUES ($1::uuid,'Legacy','legacy',now())`,
      adminId,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "Product" (id,name,slug,description,"categoryId","updatedAt") VALUES ($1::uuid,'Legacy','legacy','',$1::uuid,now())`,
      adminId,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ProductVariant" (id,"productId",sku,name,price,currency,stock,"updatedAt") VALUES ($1::uuid,$1::uuid,'legacy','Legacy',12.34,'COP',17,now())`,
      adminId,
    );
    const migration = readFileSync(
      resolve(__dirname, '../prisma/migrations/20261003000000_phase_3_inventory/migration.sql'),
      'utf8',
    );
    for (const statement of migration.split('-- statement').filter((part) => part.trim()))
      await db.$executeRawUnsafe(statement);
    expect(await stock(adminId)).toEqual({ onHand: 17, reserved: 0 });
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CATALOG_ENVIRONMENT)
      .useValue(
        parseEnvironment({
          DATABASE_URL: url.toString(),
          JWT_ACCESS_SECRET: accessSecret,
          CATALOG_INTERNAL_TOKEN: internalToken,
          CATALOG_ADMIN_SECRET: adminSecret,
          NODE_ENV: 'test',
        }),
      )
      .compile();
    app = fixture.createNestApplication<NestExpressApplication>();
    configureHttpApp(app);
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (root) {
      await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await root.$disconnect();
    }
  });

  beforeEach(async () => {
    productId = randomUUID();
    variantId = randomUUID();
    secondId = randomUUID();
    await db.$executeRawUnsafe(
      `INSERT INTO "Product" (id,name,slug,description,"categoryId","updatedAt") VALUES ($1::uuid,'Coffee',$1,'',$2::uuid,now())`,
      productId,
      adminId,
    );
    for (const id of [variantId, secondId])
      await db.$executeRawUnsafe(
        `INSERT INTO "ProductVariant" (id,"productId",sku,name,price,currency,"onHand","updatedAt") VALUES ($1::uuid,$2::uuid,$1,'Coffee',1234567890123456.78,'COP',5,now())`,
        id,
        productId,
      );
  });

  it('reserves exact snapshots once with a Catalog UTC deadline and rejects changed retries', async () => {
    const attempt = randomUUID();
    const [first, retry] = await Promise.all([
      reserve(attempt, [line(secondId), line()]),
      reserve(attempt, [line(), line(secondId)]),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      attemptId: attempt,
      state: 'ACTIVE',
      publicationRevision: null,
      lines: expect.arrayContaining([
        { variantId, quantity: 2, unit_price_decimal: '1234567890123456.78', currency: 'COP' },
      ]),
    });
    expect(Date.parse(first.body.expiresAt) - Date.parse(first.body.reservedAt)).toBe(900000);
    expect(Math.abs(Date.now() - Date.parse(first.body.reservedAt))).toBeLessThan(5000);
    expect(await stock()).toEqual({ onHand: 5, reserved: 2 });
    expect((await reserve(attempt, [line(variantId, 3)]).expect(409)).body.code).toBe(
      'RESERVATION_LINES_MISMATCH',
    );
    expect((await status(attempt).expect(200)).body).toEqual(first.body);
  });

  it('reserves overlapping reversed batches all-or-none without overselling', async () => {
    const results = await Promise.all([
      reserve(randomUUID(), [line(variantId, 4), line(secondId, 4)]),
      reserve(randomUUID(), [line(secondId, 4), line(variantId, 4)]),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await stock()).toEqual({ onHand: 5, reserved: 4 });
    expect(await stock(secondId)).toEqual({ onHand: 5, reserved: 4 });
  });

  it('rechecks canonical prices inside reserve and never partially reserves', async () => {
    const attempt = randomUUID();
    await db.$executeRawUnsafe(
      'UPDATE "ProductVariant" SET price = 1.01 WHERE id = $1::uuid',
      secondId,
    );
    const result = await reserve(attempt, [line(), line(secondId)]).expect(409);
    expect(result.body).toMatchObject({
      code: 'CHECKOUT_PRICE_CHANGED',
      request_id: result.headers['x-request-id'],
      details: {
        currentPrices: expect.arrayContaining([
          { variantId: secondId, price_decimal: '1.01', currency: 'COP' },
        ]),
      },
    });
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
    await status(attempt).expect(404);
  });

  it('projects available inventory on public, legacy, and v1 reads', async () => {
    await reserve().expect(201);
    const single = await request(app.getHttpServer())
      .get(`/internal/v1/variants/${variantId}`)
      .set('x-internal-service-token', internalToken)
      .expect(200);
    expect(single.body).toEqual({
      variantId,
      sellable: true,
      available: 3,
      price_decimal: '1234567890123456.78',
      currency: 'COP',
    });
    const legacy = await request(app.getHttpServer())
      .post('/internal/variants/batch')
      .set('x-internal-service-token', internalToken)
      .send({ ids: [variantId] })
      .expect(201);
    expect(legacy.body[0]).toMatchObject({ stock: 3, available: 3 });
    expect(legacy.body[0]).not.toHaveProperty('onHand');
    const product = await request(app.getHttpServer()).get(`/products/${productId}`).expect(200);
    expect(product.body.variants.find((v: { id: string }) => v.id === variantId)).toMatchObject({
      stock: 3,
      available: 3,
    });
  });

  it('publishes once, recovers its revision, and releases exactly once under concurrency', async () => {
    const attempt = randomUUID();
    const orderId = randomUUID();
    const reserved = (await reserve(attempt).expect(201)).body;
    const first = (await publish(attempt, orderId).expect(201)).body;
    expect(first).toMatchObject({
      state: 'PUBLISHED',
      boundOrderId: orderId,
      publicationRevision: 1,
      expiresAt: reserved.expiresAt,
    });
    expect((await publish(attempt, orderId).expect(201)).body).toEqual(first);
    expect((await status(attempt).expect(200)).body).toEqual(first);
    await publish(attempt).expect(409);
    const releases = await Promise.all([release(attempt), release(attempt)]);
    expect(releases.map((result) => result.body.state)).toEqual(['RELEASED', 'RELEASED']);
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
    expect((await reserve(attempt).expect(201)).body.state).toBe('RELEASED');
    await publish(attempt, orderId).expect(409);
  });

  it('expires a published reservation once and durably retains the publication revision', async () => {
    const attempt = randomUUID();
    const orderId = randomUUID();
    await reserve(attempt).expect(201);
    await publish(attempt, orderId).expect(201);
    await expire(attempt);
    const results = await Promise.all([
      status(attempt),
      release(attempt),
      publish(attempt, orderId),
    ]);
    expect(results[0].body).toMatchObject({
      state: 'EXPIRED',
      boundOrderId: orderId,
      publicationRevision: 1,
    });
    expect(results[1].body.state).toBe('EXPIRED');
    expect(results[2].body.code).toBe('RESERVATION_EXPIRED');
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
    const events = await db.$queryRawUnsafe<
      Array<{ publicationRevision: number; boundOrderId: string }>
    >(
      'SELECT "publicationRevision", "boundOrderId" FROM "ReservationExpiryEvent" WHERE "attemptId" = $1::uuid',
      attempt,
    );
    expect(events).toEqual([{ publicationRevision: 1, boundOrderId: orderId }]);
  });

  it('the worker expires unattended active and published rows exactly once', async () => {
    const active = randomUUID();
    const published = randomUUID();
    await reserve(active, [line(variantId, 1)]).expect(201);
    await reserve(published, [line(variantId, 1)]).expect(201);
    await publish(published).expect(201);
    await expire(active);
    await expire(published);
    const worker = app.get(ReservationExpiryWorker);
    await Promise.all([worker.tick(), app.get(ReservationService).expireDue()]);
    await worker.tick();
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
    const rows = await db.stockReservation.findMany({
      where: { attemptId: { in: [active, published] } },
      orderBy: { publicationRevision: 'asc' },
    });
    expect(rows.map((row) => row.state)).toEqual(['EXPIRED', 'EXPIRED']);
    expect(
      await db.reservationExpiryEvent.count({ where: { attemptId: { in: [active, published] } } }),
    ).toBe(2);
  });

  it('serializes publication before a waiting worker and preserves its revision in later expiry', async () => {
    const attempt = randomUUID();
    const orderId = randomUUID();
    await reserve(attempt).expect(201);
    // Pause the real publication UPDATE after it has acquired the reservation
    // lock. The old committed deadline remains visible to the expiry scanner.
    const gateKey = 31003;
    await db.$executeRawUnsafe(`CREATE FUNCTION pause_publication() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${gateKey}); RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER pause_publication AFTER UPDATE ON "StockReservation"
      FOR EACH ROW WHEN (NEW.state = 'PUBLISHED' AND OLD.state = 'ACTIVE') EXECUTE FUNCTION pause_publication()`);
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let ready!: () => void;
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${gateKey})::text`);
      ready();
      await gate;
    });
    const waitFor = async (predicate: () => Promise<boolean>) => {
      const deadline = Date.now() + 3500;
      while (!(await predicate())) {
        if (Date.now() >= deadline) throw new Error('Expected database lock state not reached');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    let publishing: Promise<request.Response> | undefined;
    let expiring: Promise<void> | undefined;
    try {
      await acquired;
      await db.$executeRawUnsafe(
        `UPDATE "StockReservation" SET "expiresAt" = clock_timestamp() + interval '1 second' WHERE "attemptId" = $1::uuid`,
        attempt,
      );
      publishing = publish(attempt, orderId).then((result) => result);
      await waitFor(
        async () =>
          (
            await db.$queryRawUnsafe<Array<{ count: bigint }>>(
              `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = ${gateKey} AND NOT granted`,
            )
          )[0].count > 0n,
      );
      await waitFor(
        async () =>
          (
            await db.$queryRawUnsafe<Array<{ due: boolean }>>(
              `SELECT "expiresAt" <= clock_timestamp() AS due FROM "StockReservation" WHERE "attemptId" = $1::uuid`,
              attempt,
            )
          )[0].due,
      );
      expiring = app.get(ReservationService).expireDue();
      await waitFor(
        async () =>
          (
            await db.$queryRawUnsafe<Array<{ count: bigint }>>(
              `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%StockReservation%FOR UPDATE%'`,
            )
          )[0].count > 0n,
      );
      unlock();
      await holding;
      const publication = await publishing;
      expect(publication.status).toBe(201);
      expect(publication.body).toMatchObject({
        state: 'PUBLISHED',
        publicationRevision: 1,
        boundOrderId: orderId,
      });
      await expiring;
      const current = (await status(attempt).expect(200)).body;
      expect(current).toMatchObject({
        state: 'EXPIRED',
        publicationRevision: 1,
        boundOrderId: orderId,
      });
      expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
      expect(
        await db.reservationExpiryEvent.findFirst({ where: { attemptId: attempt } }),
      ).toMatchObject({ publicationRevision: 1, boundOrderId: orderId });
    } finally {
      unlock();
      await holding;
      await Promise.allSettled([publishing, expiring]);
      await db.$executeRawUnsafe('DROP TRIGGER pause_publication ON "StockReservation"');
      await db.$executeRawUnsafe('DROP FUNCTION pause_publication()');
    }
  }, 10000);

  it('rejects unsellable, missing and mixed-currency variants without changing any stock', async () => {
    expect((await reserve(randomUUID(), [line(randomUUID())]).expect(404)).body.code).toBe(
      'VARIANT_NOT_FOUND',
    );
    await db.productVariant.update({ where: { id: secondId }, data: { active: false } });
    expect((await reserve(randomUUID(), [line(), line(secondId)]).expect(422)).body.code).toBe(
      'VARIANT_UNSELLABLE',
    );
    await db.productVariant.update({
      where: { id: secondId },
      data: { active: true, currency: 'USD' },
    });
    expect(
      (
        await reserve(randomUUID(), [
          line(),
          { ...line(secondId), expected_currency: 'USD' },
        ]).expect(422)
      ).body.code,
    ).toBe('MIXED_CURRENCY');
    await db.product.update({ where: { id: productId }, data: { active: false } });
    expect((await reserve().expect(422)).body.code).toBe('VARIANT_UNSELLABLE');
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
    expect(await stock(secondId)).toEqual({ onHand: 5, reserved: 0 });
  });

  it('cannot publish when expiry obtains the reservation lock first', async () => {
    const attempt = randomUUID();
    await reserve(attempt).expect(201);
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const holding = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM "StockReservation" WHERE "attemptId" = $1::uuid FOR UPDATE',
        attempt,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "StockReservation" SET "expiresAt" = clock_timestamp() - interval '1 second' WHERE "attemptId" = $1::uuid`,
        attempt,
      );
      locked();
      await gate;
    });
    await acquired;
    const pending = publish(attempt).then((result) => result);
    unlock();
    await holding;
    expect((await pending).body.code).toBe('RESERVATION_EXPIRED');
    expect((await status(attempt)).body).toMatchObject({
      state: 'EXPIRED',
      publicationRevision: null,
    });
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
  });

  it('blocks reservation-breaking admin changes and schema-level inventory violations', async () => {
    const attempt = randomUUID();
    await reserve(attempt).expect(201);
    const patch = (body: object) =>
      request(app.getHttpServer())
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
    await patch({ name: 'Still allowed' }).expect(200);
    expect(
      (
        await patch({
          variants: [{ sku: 'replacement', name: 'New', price: '1', currency: 'COP', stock: 5 }],
        }).expect(409)
      ).body.code,
    ).toBe('INVENTORY_RESERVED');
    const adjust = (onHand: number) =>
      request(app.getHttpServer())
        .patch(`/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ onHand });
    const conflict = await adjust(1).expect(409);
    expect(conflict.body.details).toMatchObject({ available: 3, reserved: 2 });
    await adjust(2).expect(200);
    await request(app.getHttpServer())
      .delete(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    await expect(
      db.$executeRawUnsafe(
        'UPDATE "ProductVariant" SET "onHand" = 1 WHERE id = $1::uuid',
        variantId,
      ),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe('DELETE FROM "ProductVariant" WHERE id = $1::uuid', variantId),
    ).rejects.toThrow();
    await release(attempt).expect(200);
    await patch({
      variants: [{ sku: randomUUID(), name: 'New', price: '1', currency: 'COP', stock: 5 }],
    }).expect(200);
    expect((await status(attempt)).body.lines[0].variantId).toBe(variantId);
  });

  it('requires a publication revision when binding an order at the database boundary', async () => {
    const attempt = randomUUID();
    await reserve(attempt).expect(201);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "StockReservation" SET state = 'PUBLISHED',
      "boundOrderId" = $2::uuid, "publishedAt" = clock_timestamp() WHERE "attemptId" = $1::uuid`,
        attempt,
        randomUUID(),
      ),
    ).rejects.toThrow();
  });

  it('guards every private endpoint and rejects malformed lines and caller expiry', async () => {
    const attempt = randomUUID();
    for (const call of [
      () => reserve(attempt),
      () => publish(attempt),
      () => status(attempt),
      () => release(attempt),
      () => request(app.getHttpServer()).get(`/internal/v1/variants/${variantId}`),
    ]) {
      const result = await call().set('x-internal-service-token', 'wrong').expect(401);
      expect(result.body.code).toBe('UNAUTHENTICATED');
    }
    for (const body of [
      { attemptId: attempt, lines: [] },
      { attemptId: attempt, lines: [line(), line()] },
      { attemptId: attempt, lines: [line(variantId, 0)] },
      { attemptId: attempt, lines: [{ ...line(), expected_price_decimal: 1.01 }] },
      { attemptId: attempt, lines: [line()], expiresAt: new Date().toISOString() },
    ])
      await request(app.getHttpServer())
        .post(base)
        .set('x-internal-service-token', internalToken)
        .send(body)
        .expect(400);
    await request(app.getHttpServer())
      .patch(`/variants/${variantId}/stock`)
      .set('x-internal-service-token', internalToken)
      .send({ onHand: 1 })
      .expect(401);
    expect(await stock()).toEqual({ onHand: 5, reserved: 0 });
  });
});
