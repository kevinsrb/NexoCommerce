import request from 'supertest';
import { CartHarness, emptyCart, missingId, otherId, userId, variantId } from './cart-harness';

describe('Cart domain through real service, repository and HTTP', () => {
  const h = new CartHarness();
  beforeAll(async () => h.start());
  beforeEach(() => h.reset());
  afterAll(async () => h.close());
  const http = () => request(h.app.getHttpServer());
  const auth = () => `Bearer ${h.token()}`;
  const add = (id = variantId, quantity = 1) =>
    http().post('/cart/items').set('Authorization', auth()).send({ variantId: id, quantity });
  const get = () => http().get('/cart').set('Authorization', auth());
  const patch = (id: string, quantity: number) =>
    http().patch(`/cart/items/${id}`).set('Authorization', auth()).send({ quantity });
  const remove = (id: string) => http().delete(`/cart/items/${id}`).set('Authorization', auth());
  const clear = () => http().delete('/cart').set('Authorization', auth());

  it('returns an empty cart without creating state or calling Catalog', async () => {
    expect((await get().expect(200)).body).toEqual(emptyCart);
    expect(h.values.size).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it.each(['add', 'update'])('returns the confirmed %s without another Catalog request after committing', async (operation) => {
    h.values.set(`cart:${userId}`, JSON.stringify({
      currency: 'USD', items: [{ variantId, quantity: 1 }, { variantId: otherId, quantity: 1 }],
      updatedAt: '2026-09-13T00:00:00.000Z',
    }));
    h.beforeMutation = () => {
      h.values.set(`cart:${userId}`, JSON.stringify({
        currency: 'USD', items: [{ variantId, quantity: 1 }, { variantId: otherId, quantity: 3 }],
        updatedAt: '2026-09-13T00:00:01.000Z',
      }));
    };
    // A second Catalog request would now fail, after Redis already committed.
    h.afterMutation = () => { h.mode = 'status'; };

    const response = await (operation === 'add' ? add(variantId, 1) : patch(variantId, 2));

    expect(response.status).toBe(operation === 'add' ? 201 : 200);
    expect(response.body).toMatchObject({ currency: 'USD', total: '0.50', itemCount: 5 });
    expect(response.body.items).toEqual([
      expect.objectContaining({ variantId, quantity: 2, subtotal: '0.20' }),
      expect.objectContaining({ variantId: otherId, quantity: 3, subtotal: '0.30' }),
    ]);
    expect(h.stored()).toMatchObject({ items: [{ variantId, quantity: 2 }, { variantId: otherId, quantity: 3 }] });
    expect(h.calls.map((call) => call.ids)).toEqual([[variantId, otherId]]);
    expect(h.writes).toHaveLength(1);
  });

  it('rejects a concurrently introduced variant before mutation when it was not in the Catalog batch', async () => {
    const concurrent = JSON.stringify({
      currency: 'USD', items: [{ variantId: otherId, quantity: 3 }],
      updatedAt: '2026-09-13T00:00:00.000Z',
    });
    h.beforeMutation = () => { h.values.set(`cart:${userId}`, concurrent); };

    const response = await add();

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CART_CONCURRENT_MODIFICATION');
    expect(h.values.get(`cart:${userId}`)).toBe(concurrent);
    expect(h.calls.map((call) => call.ids)).toEqual([[variantId]]);
    expect(h.writes).toEqual([]);
  });

  it('allows the hundredth distinct variant but rejects a hundred-and-first without changing Redis or calling Catalog', async () => {
    const fixture = h.variants[0];
    h.variants = Array.from({ length: 101 }, (_, index) => ({
      ...fixture,
      id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}`,
    }));
    h.values.set(
      `cart:${userId}`,
      JSON.stringify({
        currency: 'USD',
        items: h.variants.slice(0, 99).map((variant) => ({ variantId: variant.id, quantity: 1 })),
        updatedAt: '2026-09-13T00:00:00.000Z',
      }),
    );
    expect((await add(h.variants[99].id).expect(201)).body.itemCount).toBe(100);
    const before = h.values.get(`cart:${userId}`);
    expect((await add(h.variants[100].id).expect(400)).body.code).toBe('BAD_REQUEST');
    expect(h.values.get(`cart:${userId}`)).toBe(before);
    expect(h.calls).toHaveLength(1);
    expect(h.writes).toHaveLength(1);
    expect((await add(h.variants[0].id).expect(201)).body.itemCount).toBe(101);
  });

  it('exposes only the Cart response contract even if Catalog supplies additional fields', async () => {
    Object.assign(h.variants[0], { internalCost: 'private' });
    const response = await add().expect(201);
    expect(response.body.items[0]).not.toHaveProperty('internalCost');
    expect(response.body.items[0]).not.toHaveProperty('id');
    expect(response.body.total).toBe('0.10');
  });

  it('establishes currency and stores only IDs, quantities and timestamp with an exact thirty day TTL', async () => {
    const response = await add(variantId, 2).expect(201);
    expect(response.body).toEqual({
      currency: 'USD',
      total: '0.20',
      itemCount: 2,
      items: [
         {
           variantId,
          available: true,
           productId: userId,
          productName: 'Product',
          variantName: 'Variant',
          price: '0.10',
          currency: 'USD',
          stock: 20,
          productActive: true,
          variantActive: true,
          quantity: 2,
          subtotal: '0.20',
        },
      ],
    });
    expect(h.stored()).toEqual({
      currency: 'USD',
      items: [{ variantId, quantity: 2 }],
      updatedAt: expect.any(String),
    });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].ttl).toBe(2592000);
  });

  it('accumulates repeated adds in a single line and renews TTL exactly once per mutation', async () => {
    await add(variantId, 2).expect(201);
    const response = await add(variantId, 3).expect(201);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].quantity).toBe(5);
    expect(response.body.total).toBe('0.50');
    expect(h.writes.map((write) => write.ttl)).toEqual([2592000, 2592000]);
    expect(h.calls.map((call) => call.ids)).toEqual([[variantId], [variantId]]);
  });

  it('serializes concurrent adds without losing either quantity', async () => {
    await Promise.all([add(variantId, 1).expect(201), add(variantId, 1).expect(201)]);

    const response = await get().expect(200);
    expect(response.body.itemCount).toBe(2);
    expect(response.body.items[0]).toMatchObject({ variantId, quantity: 2 });
  });

  it('does not restore an item when update races with its deletion', async () => {
    await add(variantId, 1).expect(201);
    const [, update] = await Promise.all([
      remove(variantId).expect(204),
      patch(variantId, 2),
    ]);

    expect([200, 404]).toContain(update.status);
    expect((await get().expect(200)).body).toEqual(emptyCart);
  });

  it('treats uppercase and lowercase POST variant UUIDs as one canonical line', async () => {
    await add(variantId.toUpperCase(), 2).expect(201);
    const response = await add(variantId, 3).expect(201);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ variantId, quantity: 5 });
    expect(h.stored()).toMatchObject({ items: [{ variantId, quantity: 5 }] });
    expect(h.calls.map((call) => call.ids)).toEqual([[variantId], [variantId]]);
  });

  it('updates an existing line using an uppercase PATCH variant UUID', async () => {
    await add(variantId, 2).expect(201);
    const response = await patch(variantId.toUpperCase(), 4).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ variantId, quantity: 4 });
    expect(h.stored()).toMatchObject({ items: [{ variantId, quantity: 4 }] });
    expect(h.calls.map((call) => call.ids)).toEqual([[variantId], [variantId]]);
  });

  it('removes an existing line using an uppercase DELETE variant UUID', async () => {
    await add(variantId, 2).expect(201);
    await remove(variantId.toUpperCase()).expect(204);
    expect(h.stored()).toBeNull();
    expect((await get().expect(200)).body).toEqual(emptyCart);
    expect(h.calls).toHaveLength(1);
  });

  it.each([
    { field: 'missing', code: 'VARIANT_NOT_FOUND', status: 404 },
    { field: 'productActive', code: 'PRODUCT_INACTIVE', status: 409 },
    { field: 'variantActive', code: 'VARIANT_INACTIVE', status: 409 },
    { field: 'stock', code: 'INSUFFICIENT_STOCK', status: 409 },
  ])(
    'rejects $field with $code without changing persisted state',
    async ({ field, code, status }) => {
      await add().expect(201);
      const before = h.values.get(`cart:${userId}`);
      if (field === 'missing') h.variants = [];
      else if (field === 'stock') h.variants[0].stock = 1;
      else if (field === 'productActive') h.variants[0].productActive = false;
      else h.variants[0].variantActive = false;
      expect((await add().expect(status)).body.code).toBe(code);
      expect(h.values.get(`cart:${userId}`)).toBe(before);
      expect(h.writes).toHaveLength(1);
    },
  );

  it('replaces a present quantity and rejects missing items or quantities over stock', async () => {
    await add(variantId, 4).expect(201);
    expect((await patch(variantId, 2).expect(200)).body.itemCount).toBe(2);
    expect((await patch(missingId, 1).expect(404)).body.code).toBe('CART_ITEM_NOT_FOUND');
    expect((await patch(variantId, 21).expect(409)).body.code).toBe('INSUFFICIENT_STOCK');
    await patch(variantId, 0).expect(400);
    expect(h.writes.map((write) => write.ttl)).toEqual([2592000, 2592000]);
  });

  it('rejects a different currency addition and preserves all existing state', async () => {
    await add().expect(201);
    h.variants[1].currency = 'COP';
    const before = h.values.get(`cart:${userId}`);
    expect((await add(otherId).expect(409)).body.code).toBe('CART_CURRENCY_MISMATCH');
    expect(h.values.get(`cart:${userId}`)).toBe(before);
    expect(h.writes).toHaveLength(1);
  });

  it('computes precise current prices, summed quantities and availability on reads without renewing TTL', async () => {
    await add(variantId, 3).expect(201);
    await add(otherId, 2).expect(201);
    h.variants[0].price = '9007199254740993.10';
    h.variants[1].price = '0.20';
    h.variants[0].stock = 0;
    h.variants[0].productActive = false;
    h.variants[0].variantActive = false;
    const response = await get().expect(200);
    expect(response.body.total).toBe('27021597764222979.70');
    expect(response.body.itemCount).toBe(5);
    expect(response.body.items[0]).toMatchObject({
      price: '9007199254740993.10',
      subtotal: '27021597764222979.30',
      stock: 0,
      productActive: false,
      variantActive: false,
    });
    expect(h.writes).toHaveLength(2);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2].ids).toEqual([variantId, otherId]);
  });

  it('keeps a deleted Catalog variant visible as an unavailable zero-total line', async () => {
    await add().expect(201);
    h.variants = [];

    const response = await get().expect(200);
    expect(response.body).toEqual({
      currency: 'USD',
      items: [{ variantId, quantity: 1, available: false, subtotal: '0.00' }],
      total: '0.00',
      itemCount: 1,
    });
    await remove(variantId).expect(204);
    expect((await get().expect(200)).body).toEqual(emptyCart);
  });

  it('fails closed on current currency drift until the incompatible item is removed without Catalog', async () => {
    await add().expect(201);
    await add(otherId).expect(201);
    h.variants[0].currency = 'EUR';
    expect((await get().expect(409)).body.code).toBe('CART_CURRENCY_MISMATCH');
    h.mode = 'status';
    await remove(variantId).expect(204);
    expect(h.calls).toHaveLength(3);
    h.mode = 'ok';
    expect((await get().expect(200)).body).toMatchObject({
      currency: 'USD',
      itemCount: 1,
      total: '0.10',
    });
    expect(h.writes.map((write) => write.ttl)).toEqual([2592000, 2592000, 2592000]);
  });

  it('deletes the final key and allows a new first item to establish a different currency', async () => {
    await add().expect(201);
    await remove(variantId).expect(204);
    expect(h.stored()).toBeNull();
    expect((await get().expect(200)).body).toEqual(emptyCart);
    h.variants[1].currency = 'COP';
    expect((await add(otherId).expect(201)).body.currency).toBe('COP');
    expect(h.stored()).toMatchObject({ currency: 'COP' });
  });

  it('removes and clears idempotently without Catalog, deletes currency, and never renews unchanged TTL', async () => {
    await add().expect(201);
    const before = h.values.get(`cart:${userId}`);
    h.mode = 'status';
    await remove(missingId).expect(204);
    expect(h.values.get(`cart:${userId}`)).toBe(before);
    expect(h.writes).toHaveLength(1);
    await clear().expect(204);
    await clear().expect(204);
    await remove(missingId).expect(204);
    expect(h.calls).toHaveLength(1);
    expect(h.stored()).toBeNull();
    h.mode = 'ok';
    h.variants[1].currency = 'EUR';
    expect((await add(otherId).expect(201)).body.currency).toBe('EUR');
  });
});
