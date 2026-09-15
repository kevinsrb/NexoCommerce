import { Inject, Injectable } from '@nestjs/common';
import { type InternalCatalogVariant } from '@nexo/contracts';
import { CartDomainException } from '../common/cart-domain.exception';
import { CART_ENVIRONMENT, type CartEnvironment } from '../common/environment';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isVariant = (value: unknown): value is InternalCatalogVariant => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    uuid.test(row.id) &&
    typeof row.productId === 'string' &&
    uuid.test(row.productId) &&
    typeof row.productName === 'string' &&
    typeof row.variantName === 'string' &&
    typeof row.price === 'string' &&
    /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(row.price) &&
    typeof row.currency === 'string' &&
    /^[A-Z]{3}$/.test(row.currency) &&
    typeof row.stock === 'number' &&
    Number.isInteger(row.stock) &&
    row.stock >= 0 &&
    row.stock <= 2147483647 &&
    typeof row.productActive === 'boolean' &&
    typeof row.variantActive === 'boolean'
  );
};

@Injectable()
export class CatalogClient {
  constructor(@Inject(CART_ENVIRONMENT) private readonly environment: CartEnvironment) {}

  async getVariants(ids: string[], requestId: string): Promise<InternalCatalogVariant[]> {
    try {
      const response = await fetch(
        `${this.environment.CATALOG_SERVICE_URL.replace(/\/$/, '')}/internal/variants/batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Catalog response failed');
      }
      const body: unknown = await response.json();
      if (
        !Array.isArray(body) ||
        !body.every(isVariant) ||
        body.some((variant) => !ids.includes(variant.id)) ||
        new Set(body.map((variant) => variant.id)).size !== body.length
      ) {
        throw new Error('Invalid Catalog response');
      }
      return body;
    } catch {
      throw new CartDomainException('CATALOG_UNAVAILABLE', 'Catalog unavailable', 503);
    }
  }
}
