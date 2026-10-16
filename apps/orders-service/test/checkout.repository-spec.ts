import { body, harness, integration, principal, requestId } from './checkout-harness';

integration('Checkout durable repository', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h?.close();
  });
  it('claims principal/key once across independent concurrent repository operations', async () => {
    const rows = await Promise.all(
      Array.from({ length: 12 }, () =>
        h.repository.claim(principal, 'same-key', body.expectedPrices, requestId),
      ),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await h.db.checkoutAttempt.count()).toBe(1);
  });
  it('fences stale workers after a lease is replaced', async () => {
    const row = await h.repository.claim(principal, 'key', body.expectedPrices, requestId);
    const old = await h.repository.acquire(row.id);
    expect(old).not.toBeNull();
    expect(await h.repository.acquire(row.id)).toBeNull();
    await h.db.checkoutAttempt.update({ where: { id: row.id }, data: { leaseUntil: new Date(0) } });
    const current = await h.repository.acquire(row.id);
    expect(current).not.toBeNull();
    await expect(h.repository.save(old!, { state: 'CART_CLAIMED' })).rejects.toThrow();
    expect((await h.repository.save(current!, { state: 'CART_CLAIMED' })).state).toBe(
      'CART_CLAIMED',
    );
  });
  it('database rejects invalid order states and quantity checks', async () => {
    await expect(
      h.db.$executeRawUnsafe(`SELECT 'CONFIRMED'::"OrderRecordState"`),
    ).rejects.toThrow();
    await h.service.checkout(principal, 'key', body, requestId);
    const line = await h.db.orderLine.findFirstOrThrow();
    await expect(
      h.db.orderLine.update({ where: { id: line.id }, data: { quantity: 0 } }),
    ).rejects.toThrow();
  });
  it('database cannot expose PENDING without a publication revision', async () => {
    await h.service.checkout(principal, 'key', body, requestId);
    const order = await h.db.order.findFirstOrThrow();
    await expect(
      h.db.order.update({ where: { id: order.id }, data: { catalogPublicationRevision: null } }),
    ).rejects.toThrow();
  });
});
