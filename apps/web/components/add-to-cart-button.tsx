'use client';

import { useCart } from './cart-provider';

export function AddToCartButton({ variantId, productName }: { variantId: string | null; productName: string }) {
  const { add, loading, pending } = useCart();
  return <button
    type="button"
    className="cart-button mt-4 w-full"
    aria-label={variantId ? `Add ${productName} to cart` : `${productName} unavailable`}
    disabled={!variantId || loading || pending}
    onClick={() => { if (variantId) void add(variantId); }}
  >{!variantId ? 'Unavailable' : pending ? 'Please wait…' : 'Add to cart'}</button>;
}
