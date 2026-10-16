import request from 'supertest';
import { body, harness, integration, principal, requestId, token } from './checkout-harness';

integration('Private checkout HTTP', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h?.close();
  });
  const post = () =>
    request(h.app.getHttpServer()).post('/internal/v1/checkouts').set('x-request-id', requestId);
  it('requires verified JWT and ignores spoofed principal headers', async () => {
    await post()
      .set('x-principal-id', principal)
      .set('x-internal-service-token', 'orders-test-cart-token-at-least-32-characters')
      .set('Idempotency-Key', 'key')
      .send(body)
      .expect(401);
    await post()
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'key')
      .set('x-principal-id', 'attacker')
      .send(body)
      .expect(201);
    expect((await h.db.checkoutAttempt.findFirstOrThrow()).principalId).toBe(principal);
  });
  it('returns 201 then 200 with correlated domain errors and rejects extra identity fields', async () => {
    const auth = `Bearer ${token()}`;
    const invalid = await post().set('Authorization', auth).send(body).expect(400);
    expect(invalid.body).toMatchObject({ code: 'INVALID_REQUEST', request_id: requestId });
    await post()
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key')
      .send({ ...body, principalId: principal })
      .expect(400);
    const first = await post()
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key')
      .send(body)
      .expect(201);
    const replay = await post()
      .set('Authorization', auth)
      .set('Idempotency-Key', 'key')
      .send(body)
      .expect(200);
    expect(replay.body).toEqual(first.body);
    expect(first.headers['x-request-id']).toBe(requestId);
    await request(h.app.getHttpServer()).post('/api/checkout').send(body).expect(404);
  });
  it('returns 202 with no order or cart snapshot while publication is uncertain', async () => {
    h.state.failAfterPublish = true;
    const response = await post()
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'key')
      .send(body)
      .expect(202);
    expect(response.body).toEqual({
      code: 'CHECKOUT_PROCESSING',
      message: 'Checkout is processing',
      request_id: requestId,
    });
  });
  it('maps an unavailable intent store to sanitized 503', async () => {
    jest
      .spyOn(h.repository, 'claim')
      .mockRejectedValueOnce(new Error('private database diagnostics'));
    const response = await post()
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'key')
      .send(body)
      .expect(503);
    expect(response.body).toEqual({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Checkout unavailable',
      request_id: requestId,
    });
  });
});
