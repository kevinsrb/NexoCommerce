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
    const cart = await this.repository.getCart(userId);
    const items = cart?.items.map((item) => ({ ...item })) ?? [];
    const existing = items.find((item) => item.variantId === variantId);
    if (existing) existing.quantity += quantity;
    else items.push({ variantId, quantity });
    if (items.length > 100)
      throw new BadRequestException('Cart supports at most 100 distinct variants');
    return this.saveValidated(userId, cart?.currency, items, variantId, requestId);
  }

  async updateItem(
    userId: string,
    variantId: string,
    quantity: number,
    requestId: string,
  ): Promise<CartResponse> {
    variantId = variantId.toLowerCase();
    const cart = await this.repository.getCart(userId);
    if (!cart?.items.some((item) => item.variantId === variantId)) {
      throw new CartDomainException('CART_ITEM_NOT_FOUND', 'Cart item not found', 404);
    }
    const items = cart.items.map((item) =>
      item.variantId === variantId ? { variantId, quantity } : { ...item },
    );
    return this.saveValidated(userId, cart.currency, items, variantId, requestId);
  }

  async removeItem(userId: string, variantId: string): Promise<void> {
    variantId = variantId.toLowerCase();
    const cart = await this.repository.getCart(userId);
    if (!cart) return;
    const items = cart.items.filter((item) => item.variantId !== variantId);
    if (items.length === cart.items.length) return;
    if (!items.length) await this.repository.deleteCart(userId);
    else
      await this.repository.saveCart(userId, {
        currency: cart.currency,
        items,
        updatedAt: new Date().toISOString(),
      });
  }

  async clearCart(userId: string): Promise<void> {
    await this.repository.deleteCart(userId);
  }

  private async saveValidated(
    userId: string,
    currency: string | undefined,
    items: PersistedCart['items'],
    variantId: string,
    requestId: string,
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
    const quantity = items.find((item) => item.variantId === variantId)!.quantity;
    if (quantity > variant.stock)
      throw new CartDomainException('INSUFFICIENT_STOCK', 'Insufficient stock', 409);
    const cart = {
      currency: currency ?? variant.currency,
      items,
      updatedAt: new Date().toISOString(),
    };
    const response = this.response(cart, variants);
    await this.repository.saveCart(userId, cart);
    return response;
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
      const variant = this.variant(variants, variantId);
      if (variant.currency !== cart.currency)
        throw new CartDomainException('CART_CURRENCY_MISMATCH', 'Cart currency mismatch', 409);
      const subtotal = new Money(variant.price).times(quantity);
      total = total.plus(subtotal);
      itemCount += quantity;
      return {
        variantId,
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
