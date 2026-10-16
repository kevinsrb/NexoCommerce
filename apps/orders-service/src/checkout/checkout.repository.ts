import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type CheckoutPriceExpectation,
  type CatalogReservation,
  type CheckoutLineSnapshot,
} from '@nexo/contracts';
import { Prisma } from '../../generated/client';
import { CheckoutDomainException } from '../common/checkout-domain.exception';
import { PrismaService } from '../prisma/prisma.service';

const include = { order: { include: { lines: { orderBy: { variantId: 'asc' as const } } } } };
export type Attempt = Prisma.CheckoutAttemptGetPayload<{ include: typeof include }>;
export class LeaseLostError extends Error {}
export const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class CheckoutRepository {
  constructor(private readonly db: PrismaService) {}

  async claim(
    principalId: string,
    idempotencyKey: string,
    expectedPrices: CheckoutPriceExpectation[],
    requestId: string,
  ): Promise<Attempt> {
    const normalized = [...expectedPrices]
      .map((p) => ({
        variantId: p.variantId.toLowerCase(),
        price_decimal: p.price_decimal,
        currency: p.currency,
      }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId));
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    // createMany(skipDuplicates) is an INSERT ON CONFLICT, including concurrent first requests.
    await this.db.checkoutAttempt.createMany({
      data: {
        principalId,
        idempotencyKey,
        requestHash,
        expectedPrices: json(normalized),
        requestId,
      },
      skipDuplicates: true,
    });
    const row = await this.db.checkoutAttempt.findUniqueOrThrow({
      where: { principalId_idempotencyKey: { principalId, idempotencyKey } },
      include,
    });
    if (row.requestHash !== requestHash)
      throw new CheckoutDomainException(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key was used for another request',
        409,
      );
    return row;
  }

  async acquire(id: string): Promise<Attempt | null> {
    const owner = randomUUID();
    const changed = await this.db
      .$executeRaw`UPDATE checkout_attempts SET lease_owner = ${owner}::uuid,
      lease_until = clock_timestamp() + interval '30 seconds', saga_version = saga_version + 1
      WHERE id = ${id}::uuid AND (lease_until IS NULL OR lease_until < clock_timestamp())`;
    return changed ? this.db.checkoutAttempt.findUniqueOrThrow({ where: { id }, include }) : null;
  }

  private async fence(tx: Prisma.TransactionClient, attempt: Attempt) {
    const changed =
      await tx.$executeRaw`UPDATE checkout_attempts SET saga_version = saga_version + 1,
      lease_until = clock_timestamp() + interval '30 seconds'
      WHERE id = ${attempt.id}::uuid AND saga_version = ${attempt.sagaVersion}
      AND lease_owner = ${attempt.leaseOwner}::uuid AND lease_until > clock_timestamp()`;
    if (!changed) throw new LeaseLostError('Checkout lease lost');
  }

  async save(
    attempt: Attempt,
    data: Prisma.CheckoutAttemptUpdateManyMutationInput,
  ): Promise<Attempt> {
    return this.db.$transaction(async (tx) => {
      await this.fence(tx, attempt);
      return tx.checkoutAttempt.update({ where: { id: attempt.id }, data, include });
    });
  }

  async recordOrder(
    attempt: Attempt,
    reservation: CatalogReservation,
    totalDecimal: string,
    lines: CheckoutLineSnapshot[],
  ): Promise<Attempt> {
    return this.db.$transaction(async (tx) => {
      await this.fence(tx, attempt);
      await tx.order.create({
        data: {
          // A persisted attempt UUID is also the stable order UUID, even after a crash.
          id: attempt.id,
          checkoutAttemptId: attempt.id,
          principalId: attempt.principalId,
          cartVersion: attempt.cartVersion!,
          currency: lines[0].currency,
          totalDecimal,
          expiresAt: new Date(reservation.expiresAt),
          lines: {
            create: lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
              unitPriceDecimal: line.unit_price_decimal,
              lineTotalDecimal: line.line_total_decimal,
              currency: line.currency,
              variantSnapshot: json(line),
            })),
          },
        },
      });
      return tx.checkoutAttempt.update({
        where: { id: attempt.id },
        data: { state: 'ORDER_RECORDING', reservationRef: reservation.reservationId },
        include,
      });
    });
  }

  async lifecycle(attempt: Attempt, reservation: CatalogReservation): Promise<Attempt> {
    return this.db.$transaction(async (tx) => {
      await this.fence(tx, attempt);
      const order = attempt.order!;
      const published = reservation.state === 'PUBLISHED';
      if (published && order.state !== 'RECORDING' && order.state !== 'PENDING')
        throw new LeaseLostError('Terminal order cannot be republished');
      const result = await tx.order.updateMany({
        where: { id: order.id, version: order.version },
        data: {
          state: published ? 'PENDING' : 'EXPIRED',
          version: { increment: 1 },
          ...(reservation.publicationRevision !== null
            ? {
                catalogPublicationRevision: BigInt(reservation.publicationRevision),
                publishedAt: order.publishedAt ?? new Date(),
              }
            : {}),
        },
      });
      if (result.count !== 1) throw new LeaseLostError('Order changed concurrently');
      return tx.checkoutAttempt.update({
        where: { id: attempt.id },
        data: { state: 'ORDER_PENDING' },
        include,
      });
    });
  }

  async release(attempt: Attempt) {
    await this.db.checkoutAttempt.updateMany({
      where: { id: attempt.id, leaseOwner: attempt.leaseOwner },
      data: { leaseOwner: null, leaseUntil: null },
    });
  }

  async recoverable() {
    return this.db.checkoutAttempt.findMany({
      where: {
        recoverAfter: { lte: new Date() },
        OR: [
          { state: { notIn: ['COMPLETE', 'FAILED'] } },
          { state: 'COMPLETE', order: { state: 'PENDING' } },
        ],
      },
      orderBy: { recoverAfter: 'asc' },
      take: 100,
      select: { id: true, createdAt: true, requestId: true },
    });
  }
}
