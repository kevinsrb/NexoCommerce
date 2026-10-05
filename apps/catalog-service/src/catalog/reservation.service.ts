import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/client';
import { CatalogDomainException } from '../common/catalog-domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ReserveDto } from './reservation.dto';

const include = { lines: { orderBy: { variantId: 'asc' as const } } };
type Reservation = Prisma.StockReservationGetPayload<{ include: typeof include }>;
type Transaction = Prisma.TransactionClient;
const nonterminal = (row: Reservation) => row.state === 'ACTIVE' || row.state === 'PUBLISHED';
const present = (row: Reservation) => ({
  reservationId: row.id,
  attemptId: row.attemptId,
  state: row.state,
  reservedAt: row.reservedAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  boundOrderId: row.boundOrderId,
  publicationRevision: row.publicationRevision,
  lines: row.lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    unit_price_decimal: line.unitPrice.toFixed(2),
    currency: line.currency,
  })),
});

@Injectable()
export class ReservationService {
  constructor(private readonly prisma: PrismaService) {}

  private async now(tx: Transaction): Promise<Date> {
    const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    return row.now;
  }

  // All lifecycle operations lock this same row before reading time or state.
  private async lock(tx: Transaction, attemptId: string) {
    await tx.$queryRaw`SELECT id FROM "StockReservation" WHERE "attemptId" = ${attemptId}::uuid FOR UPDATE`;
    return tx.stockReservation.findUnique({ where: { attemptId }, include });
  }

  async reserve(dto: ReserveDto) {
    const lines = [...dto.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify(
          lines.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            price: new Prisma.Decimal(line.expected_price_decimal).toFixed(2),
            currency: line.expected_currency,
          })),
        ),
      )
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      // There may not yet be a row to lock. An attempt-scoped transaction lock
      // serializes the first insert and concurrent retries across service instances.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.attemptId}, 0))::text`;
      const existing = await this.lock(tx, dto.attemptId);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new CatalogDomainException(
            'RESERVATION_LINES_MISMATCH',
            'Attempt already has different reservation lines',
            409,
          );
        return present(await this.expireIfDue(tx, existing));
      }
      const ids = lines.map((line) => line.variantId);
      // Admin writes lock products before variants too. Holding the product lock
      // also serializes sellability changes and variant replacement with reserve.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE id IN (
        SELECT "productId" FROM "ProductVariant" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})) ORDER BY id FOR UPDATE`);
      await this.lockVariants(tx, ids);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids } },
        include: { product: true },
      });
      if (variants.length !== lines.length)
        throw new CatalogDomainException('VARIANT_NOT_FOUND', 'Variant not found', 404);
      if (variants.some((v) => !v.active || !v.product.active))
        throw new CatalogDomainException('VARIANT_UNSELLABLE', 'Variant is not sellable', 422);
      if (new Set(variants.map((v) => v.currency)).size !== 1)
        throw new CatalogDomainException(
          'MIXED_CURRENCY',
          'Reservation requires one currency',
          422,
        );
      const byId = new Map(variants.map((v) => [v.id, v]));
      if (
        lines.some((line) => {
          const variant = byId.get(line.variantId)!;
          return (
            !variant.price.equals(line.expected_price_decimal) ||
            variant.currency !== line.expected_currency
          );
        })
      )
        throw new CatalogDomainException('CHECKOUT_PRICE_CHANGED', 'Catalog prices changed', 409, {
          currentPrices: lines.map((line) => {
            const v = byId.get(line.variantId)!;
            return { variantId: v.id, price_decimal: v.price.toFixed(2), currency: v.currency };
          }),
        });
      if (
        lines.some((line) => {
          const v = byId.get(line.variantId)!;
          return v.onHand - v.reserved < line.quantity;
        })
      )
        throw new CatalogDomainException('INSUFFICIENT_STOCK', 'Insufficient available stock', 409);
      const reservedAt = await this.now(tx);
      const row = await tx.stockReservation.create({
        data: {
          attemptId: dto.attemptId,
          requestHash,
          reservedAt,
          expiresAt: new Date(reservedAt.getTime() + 15 * 60 * 1000),
          lines: {
            create: lines.map((line) => {
              const v = byId.get(line.variantId)!;
              return {
                variantId: v.id,
                quantity: line.quantity,
                unitPrice: v.price,
                currency: v.currency,
              };
            }),
          },
        },
        include,
      });
      for (const line of lines)
        await tx.productVariant.update({
          where: { id: line.variantId },
          data: { reserved: { increment: line.quantity } },
        });
      return present(row);
    });
  }

  async publish(attemptId: string, orderId: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, attemptId);
      if (!locked)
        throw new CatalogDomainException('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
      const current = await this.expireIfDue(tx, locked);
      if (current.state !== 'ACTIVE') return current;
      const changed = await tx.$executeRaw`UPDATE "StockReservation"
        SET state = 'PUBLISHED', "boundOrderId" = ${orderId}::uuid,
        "publishedAt" = clock_timestamp(), "publicationRevision" = revision + 1,
        revision = revision + 1, "updatedAt" = clock_timestamp()
        WHERE id = ${current.id}::uuid AND state = 'ACTIVE' AND "expiresAt" > clock_timestamp()`;
      return changed
        ? tx.stockReservation.findUniqueOrThrow({ where: { id: current.id }, include })
        : this.finish(tx, current, 'EXPIRED');
    });
    // Throw outside the transaction so an authoritative expiry is committed.
    if (row.state === 'EXPIRED')
      throw new CatalogDomainException('RESERVATION_EXPIRED', 'Reservation expired', 409);
    if (row.state !== 'PUBLISHED' || row.boundOrderId !== orderId)
      throw new CatalogDomainException(
        'RESERVATION_CONFLICT',
        'Reservation cannot be published for this order',
        409,
      );
    return present(row);
  }

  async status(attemptId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, attemptId);
      if (!row)
        throw new CatalogDomainException('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
      return present(await this.expireIfDue(tx, row));
    });
  }

  async release(attemptId: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, attemptId);
      if (!row)
        throw new CatalogDomainException('RESERVATION_NOT_FOUND', 'Reservation not found', 404);
      const current = await this.expireIfDue(tx, row);
      return present(nonterminal(current) ? await this.finish(tx, current, 'RELEASED') : current);
    });
  }

  async expireDue() {
    const due = await this.prisma.$queryRaw<Array<{ attemptId: string }>>`
      SELECT "attemptId" FROM "StockReservation" WHERE state IN ('ACTIVE', 'PUBLISHED')
      AND "expiresAt" <= clock_timestamp() ORDER BY "expiresAt", id LIMIT 100`;
    for (const row of due) await this.status(row.attemptId);
  }

  private async expireIfDue(tx: Transaction, row: Reservation) {
    return nonterminal(row) && (await this.now(tx)).getTime() >= row.expiresAt.getTime()
      ? this.finish(tx, row, 'EXPIRED')
      : row;
  }

  private async lockVariants(tx: Transaction, ids: string[]) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`,
    );
  }

  private async finish(tx: Transaction, row: Reservation, state: 'EXPIRED' | 'RELEASED') {
    await this.lockVariants(
      tx,
      row.lines.map((line) => line.variantId),
    );
    for (const line of row.lines)
      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { reserved: { decrement: line.quantity } },
      });
    const updated = await tx.stockReservation.update({
      where: { id: row.id },
      data: { state, revision: { increment: 1 } },
      include,
    });
    if (state === 'EXPIRED')
      await tx.reservationExpiryEvent.create({
        data: {
          reservationId: row.id,
          attemptId: row.attemptId,
          boundOrderId: row.boundOrderId,
          publicationRevision: row.publicationRevision,
          occurredAt: await this.now(tx),
        },
      });
    return updated;
  }
}
