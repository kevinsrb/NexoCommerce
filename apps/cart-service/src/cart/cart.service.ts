import { BadRequestException, Injectable } from '@nestjs/common';
import { type CartResponse, type InternalCatalogVariant } from '@nexo/contracts';
import Decimal from 'decimal.js';
import { CatalogClient } from '../catalog/catalog.client';
import { CartDomainException } from '../common/cart-domain.exception';
import { CartRepository, type PersistedCart } from './cart.repository';

// Catalog Decimal(18,2), integer quantities, and a batch of up to 100 lines.
const Money = Decimal.clone({ precision: 40 });
const emptyCart = (): CartResponse => ({ currency: null, items: [], total: '0.00', itemCount: 0 });

@Injectable()
export class CartService {
  constructor(
    private readonly repository: CartRepository,
    private readonly catalog: CatalogClient,
  ) {}

  async getCart(userId: string, requestId: string): Promise<CartResponse> {
    const cart = await this.repository.getCart(userId);
    if (!cart || !cart.items.length) return emptyCart();
    const variants = await this.catalog.getVariants(
      cart.items.map((item) => item.variantId),
      requestId,
    );
    return this.response(cart, variants);
  }

  async addItem(
    userId: string,
    variantId: string,
    quantity: number,
    requestId: string,
  ): Promise<CartResponse> {
    variantId = variantId.toLowerCase();
    const cart = await this.repository.getMutableCart(userId);
    const items = cart?.items.map((item) => ({ ...item })) ?? [];
    const existing = items.find((item) => item.variantId === variantId);
    if (existing) existing.quantity += quantity;
    else items.push({ variantId, quantity });
    if (items.length > 100)
      throw new BadRequestException('Cart supports at most 100 distinct variants');
    return this.mutateValidated(userId, cart, items, variantId, quantity, requestId, 'add');
  }

  async updateItem(
    userId: string,
    variantId: string,
    quantity: number,
    requestId: string,
  ): Promise<CartResponse> {
    variantId = variantId.toLowerCase();
    const cart = await this.repository.getMutableCart(userId);
    if (!cart?.items.some((item) => item.variantId === variantId)) {
      throw new CartDomainException('CART_ITEM_NOT_FOUND', 'Cart item not found', 404);
    }
    const items = cart.items.map((item) =>
      item.variantId === variantId ? { variantId, quantity } : { ...item },
    );
    return this.mutateValidated(userId, cart, items, variantId, quantity, requestId, 'update');
  }

  async removeItem(userId: string, variantId: string): Promise<void> {
    variantId = variantId.toLowerCase();
    const result = await this.repository.mutateCart(userId, {
      operation: 'remove',
      variantId,
      updatedAt: new Date().toISOString(),
    });
    if (result === -7) this.checkoutInProgress();
  }

  async clearCart(userId: string): Promise<void> {
    const result = await this.repository.mutateCart(userId, { operation: 'clear' });
    if (result === -7) this.checkoutInProgress();
  }

  readCheckout(principalId: string) { return this.repository.readCheckoutSnapshot(principalId); }
  claimCheckout(principalId: string, attemptId: string, version: number) {
    return this.repository.claimCheckout(principalId, attemptId, version);
  }
  completeCheckout(principalId: string, attemptId: string, version: number) {
    return this.repository.completeCheckout(principalId, attemptId, version);
  }
  releaseCheckout(principalId: string, attemptId: string, version: number) {
    return this.repository.releaseCheckout(principalId, attemptId, version);
  }

  private checkoutInProgress(): never {
    throw new CartDomainException('CART_CHECKOUT_IN_PROGRESS', 'Cart checkout in progress', 409);
  }

  private async mutateValidated(
    userId: string,
    cart: PersistedCart | null,
    items: PersistedCart['items'],
    variantId: string,
    quantity: number,
    requestId: string,
    operation: 'add' | 'update',
  ): Promise<CartResponse> {
    const variants = await this.catalog.getVariants(
      items.map((item) => item.variantId),
      requestId,
    );
    const variant = this.variant(variants, variantId);
    if (!variant.productActive)
      throw new CartDomainException('PRODUCT_INACTIVE', 'Product is inactive', 409);
    if (!variant.variantActive)
      throw new CartDomainException('VARIANT_INACTIVE', 'Variant is inactive', 409);
    const requestedQuantity = operation === 'add'
      ? (cart?.items.find((item) => item.variantId === variantId)?.quantity ?? 0) + quantity
      : quantity;
    if (requestedQuantity > variant.stock)
      throw new CartDomainException('INSUFFICIENT_STOCK', 'Insufficient stock', 409);
    const expectedCurrency = cart?.currency ?? variant.currency;
    const snapshot = {
      currency: expectedCurrency,
      items,
      updatedAt: new Date().toISOString(),
    };
    this.response(snapshot, variants);
    const result = await this.repository.mutateCart(userId, {
      operation,
      variantId,
      quantity,
      currency: expectedCurrency,
      stock: variant.stock,
      updatedAt: snapshot.updatedAt,
      validatedIds: items.map((item) => item.variantId),
    });
    if (result === -2)
      throw new CartDomainException('CART_CURRENCY_MISMATCH', 'Cart currency mismatch', 409);
    if (result === -3)
      throw new CartDomainException('INSUFFICIENT_STOCK', 'Insufficient stock', 409);
    if (result === -4)
      throw new CartDomainException('CART_ITEM_NOT_FOUND', 'Cart item not found', 404);
    if (result === -5)
      throw new BadRequestException('Cart supports at most 100 distinct variants');
    if (result === -6)
      throw new CartDomainException('CART_CONCURRENT_MODIFICATION', 'Cart changed; please retry', 409);
    if (result === -7) this.checkoutInProgress();
    if (typeof result === 'number') throw new Error('Invalid cart mutation result');
    return this.response(result, variants);
  }

  private variant(variants: InternalCatalogVariant[], id: string): InternalCatalogVariant {
    const variant = variants.find((candidate) => candidate.id === id);
    if (!variant) throw new CartDomainException('VARIANT_NOT_FOUND', 'Variant not found', 404);
    return variant;
  }

  private response(cart: PersistedCart, variants: InternalCatalogVariant[]): CartResponse {
    let total = new Money(0);
    let itemCount = 0;
    const items = cart.items.map(({ variantId, quantity }) => {
      const variant = variants.find((candidate) => candidate.id === variantId);
      itemCount += quantity;
      if (!variant) {
        return { variantId, quantity, available: false, subtotal: '0.00' };
      }
      if (variant.currency !== cart.currency)
        throw new CartDomainException('CART_CURRENCY_MISMATCH', 'Cart currency mismatch', 409);
      const subtotal = new Money(variant.price).times(quantity);
      total = total.plus(subtotal);
      return {
        variantId,
        available: true,
        productId: variant.productId,
        productName: variant.productName,
        variantName: variant.variantName,
        price: variant.price,
        currency: variant.currency,
        stock: variant.stock,
        productActive: variant.productActive,
        variantActive: variant.variantActive,
        quantity,
        subtotal: subtotal.toFixed(2),
      };
    });
    return { currency: cart.currency, items, total: total.toFixed(2), itemCount };
  }
}
