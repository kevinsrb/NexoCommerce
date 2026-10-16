import { body, harness, integration, principal, requestId } from './checkout-harness';
import { CheckoutRecoveryWorker } from '../src/checkout/checkout-recovery.worker';
import { CheckoutDomainException } from '../src/common/checkout-domain.exception';

integration('Durable checkout saga', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h?.close();
  });
  const run = (key = 'checkout-one', input = body) =>
    h.service.checkout(principal, key, input, requestId);

  it('publishes before visibility, persists revision and exact immutable totals', async () => {
    const first = await run();
    expect(first).toMatchObject({
      status: 201,
      body: {
        state: 'PENDING',
        total_decimal: '3703703670370370.34',
        publicationRevision: 2,
        lines: [
          {
            unit_price_decimal: '1234567890123456.78',
            line_total_decimal: '3703703670370370.34',
            quantity: 3,
          },
        ],
      },
    });
    const stored = await h.db.order.findFirstOrThrow();
    expect(stored.catalogPublicationRevision).toBe(2n);
    h.state.price = '1.00';
    expect(await run()).toEqual({ status: 200, body: first.body });
    expect(h.state.version).toBe(8);
    expect(await h.db.order.count()).toBe(1);
  });
  it('returns same ID and snapshot with current EXPIRED after authoritative expiry', async () => {
    const first = await run();
    [...h.state.reservations.values()][0].state = 'EXPIRED';
    expect(await run()).toEqual({ status: 200, body: { ...first.body, state: 'EXPIRED' } });
    expect((await h.db.order.findFirstOrThrow()).state).toBe('EXPIRED');
  });
  it('fails closed rather than replaying stale PENDING when status is unavailable', async () => {
    await run();
    h.state.unavailableStatus = true;
    expect(await run()).toMatchObject({ status: 202, body: { code: 'CHECKOUT_PROCESSING' } });
  });
  it('rejects key reuse with different expected prices before further effects', async () => {
    await run();
    const calls = h.state.calls.length;
    await expect(
      run('checkout-one', {
        expectedPrices: [{ ...body.expectedPrices[0], price_decimal: '1.00' }],
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(h.state.calls).toHaveLength(calls);
  });
  it('serializes concurrent duplicate keys and never creates two reservations', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => run()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => [200, 201, 202].includes(r.status))).toBe(true);
    expect(h.state.reservations.size).toBe(1);
    expect(await h.db.order.count()).toBe(1);
  });
  it('prevents two keys from accepting the same cart version', async () => {
    let release!: () => void;
    let reads = 0;
    h.state.holdRead = new Promise<void>((resolve) => { release = resolve; });
    h.state.onRead = () => { if (++reads === 2) release(); };
    const results = await Promise.allSettled([run('one'), run('two')]);
    expect(results.filter((r) => r.status === 'fulfilled' && r.value.status === 201)).toHaveLength(
      1,
    );
    expect(h.state.reservations.size).toBe(1);
    expect(await h.db.order.count()).toBe(1);
    expect(h.state.calls.filter((call) => call.path.endsWith('/checkout-claims')).map((call) => call.body.expectedVersion)).toEqual([7, 7]);
  });
  it.each(['failClaim', 'failAfterReserve', 'failAfterPublish'] as const)(
    'recovers %s with the same durable attempt and order identifiers',
    async (failure) => {
      h.state[failure] = true;
      expect(await run()).toMatchObject({ status: 202 });
      const attempt = await h.db.checkoutAttempt.findFirstOrThrow();
      expect(h.state.claim).toBe(attempt.id);
      await h.app.get(CheckoutRecoveryWorker).tick();
      const result = await run();
      expect(result).toMatchObject({
        status: 200,
        body: { orderId: attempt.id, state: 'PENDING' },
      });
      expect(h.state.reservations.size).toBe(1);
      expect(await h.db.order.count()).toBe(1);
    },
  );
  it('retains publication despite a Cart completion failure and recovers completion', async () => {
    h.state.failComplete = true;
    expect(await run()).toMatchObject({ status: 201 });
    expect(h.state.claim).not.toBe('');
    h.state.failComplete = false;
    await h.app.get(CheckoutRecoveryWorker).tick();
    expect(h.state.claim).toBe('');
    expect((await h.db.checkoutAttempt.findFirstOrThrow()).state).toBe('COMPLETE');
  });
  it('does not expose RECORDING when expiry wins publication', async () => {
    h.state.expireBeforePublish = true;
    await expect(run()).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
    expect((await h.db.order.findFirstOrThrow()).state).toBe('EXPIRED');
    expect(h.state.claim).toBe('');
    await expect(run()).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
  });
  it('allows reconfirmation of the same cart after an unpublished reservation expired', async () => {
    h.state.expireBeforePublish = true;
    await expect(run()).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
    h.state.expireBeforePublish = false;
    expect(await run('after-unpublished-expiry')).toMatchObject({ status: 201, body: { state: 'PENDING' } });
    expect(await h.db.order.count({ where: { state: 'PENDING' } })).toBe(1);
  });
  it('persists canonical price errors and releases claim without reserving', async () => {
    h.state.price = '12.00';
    await expect(run()).rejects.toMatchObject({
      code: 'CHECKOUT_PRICE_CHANGED',
      details: {
        currentPrices: [
          { variantId: body.expectedPrices[0].variantId, price_decimal: '12.00', currency: 'COP' },
        ],
      },
    });
    expect(h.state.claim).toBe('');
    expect(h.state.reservations.size).toBe(0);
    await expect(run()).rejects.toMatchObject({ code: 'CHECKOUT_PRICE_CHANGED' });
    expect(
      await run('reconfirmed', {
        expectedPrices: [{ ...body.expectedPrices[0], price_decimal: '12.00' }],
      }),
    ).toMatchObject({ status: 201 });
  });
  it('releases safely on known stock rejection and preserves a stable failure', async () => {
    h.state.reserveError = 'INSUFFICIENT_STOCK';
    await expect(run()).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(h.state.claim).toBe('');
    expect((await h.db.checkoutAttempt.findFirstOrThrow()).state).toBe('FAILED');
  });
  it('propagates request ID and distinct service credentials without forwarding JWT', async () => {
    await run();
    for (const call of h.state.calls) {
      expect(call.headers['x-request-id']).toBe(requestId);
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers['x-internal-service-token']).toBe(
        call.path.includes('/cart/')
          ? 'orders-test-cart-token-at-least-32-characters'
          : 'orders-test-catalog-token-at-least-32-characters',
      );
    }
  });
  it.each(['recordOrder', 'lifecycle'] as const)(
    'recovers a database crash at %s with stable IDs and no duplicate stock reservation',
    async (method) => {
      jest
        .spyOn(h.repository, method)
        .mockRejectedValueOnce(new Error('simulated database connection loss'));
      expect(await run()).toMatchObject({ status: 202 });
      const attempt = await h.db.checkoutAttempt.findFirstOrThrow();
      expect(h.state.claim).toBe(attempt.id);
      await h.app.get(CheckoutRecoveryWorker).tick();
      expect(await run()).toMatchObject({
        status: 200,
        body: { orderId: attempt.id, state: 'PENDING' },
      });
      expect(h.state.reservations.size).toBe(1);
      expect(await h.db.order.count()).toBe(1);
    },
  );
  it('retains a Cart claim until release of an active reservation is confirmed', async () => {
    jest
      .spyOn(h.repository, 'recordOrder')
      .mockRejectedValueOnce(
        new CheckoutDomainException('INVALID_REQUEST', 'Abandoned before publication', 400),
      );
    h.state.failRelease = true;
    expect(await run()).toMatchObject({ status: 202 });
    const attempt = await h.db.checkoutAttempt.findFirstOrThrow();
    expect(attempt.state).not.toBe('FAILED');
    expect(h.state.claim).toBe(attempt.id);
    expect(h.state.calls.filter((c) => c.path.endsWith('/checkout-claims/release'))).toHaveLength(
      0,
    );
    h.state.failRelease = false;
    await expect(run()).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(h.state.reservations.get(attempt.id)?.state).toBe('RELEASED');
    expect(h.state.claim).toBe('');
    expect((await h.db.checkoutAttempt.findFirstOrThrow()).state).toBe('FAILED');
  });
  it('rejects empty, unsellable and mixed-currency carts before any reservation', async () => {
    h.state.lines = [];
    await expect(run('empty')).rejects.toMatchObject({ code: 'CART_EMPTY' });
    h.state.lines = [{ variantId: body.expectedPrices[0].variantId, quantity: 3 }];
    h.state.sellable = false;
    await expect(run('unsellable')).rejects.toMatchObject({ code: 'VARIANT_UNSELLABLE' });
    h.state.sellable = true;
    const second = '550e8400-e29b-41d4-a716-446655440009';
    h.state.lines.push({ variantId: second, quantity: 1 });
    h.state.currencies.set(second, 'USD');
    await expect(
      run('mixed', {
        expectedPrices: [
          ...body.expectedPrices,
          { variantId: second, price_decimal: '1234567890123456.78', currency: 'USD' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'MIXED_CURRENCY' });
    expect(h.state.reservations.size).toBe(0);
    expect(h.state.claim).toBe('');
  });
});
