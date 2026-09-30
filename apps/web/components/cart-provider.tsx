'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { addCartItem, CartClientError, clearCart, loadCart, removeCartItem, updateCartItem, type Cart } from '../lib/cart';

type CartContextValue = {
  cart: Cart | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  errorCode: string | null;
  retry: () => Promise<void>;
  add: (variantId: string) => Promise<void>;
  update: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  clear: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(async (operation: () => Promise<Cart | void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setErrorCode(null);
    try {
      const result = await operation();
      setCart(result ?? await loadCart());
    } catch (failure) {
      setErrorCode(failure instanceof CartClientError ? failure.code : null);
      setError(failure instanceof Error ? failure.message : 'Unable to load your cart. Please retry.');
    } finally {
      busy.current = false;
      setPending(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(loadCart); }, [run]);

  return <CartContext.Provider value={{
    cart, loading, pending, error, errorCode,
    retry: () => run(loadCart),
    add: (variantId) => run(() => addCartItem(variantId)),
    update: (variantId, quantity) => run(() => updateCartItem(variantId, quantity)),
    remove: (variantId) => run(() => removeCartItem(variantId)),
    clear: () => run(clearCart),
  }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('Cart controls require CartProvider');
  return context;
}

export function CartError() {
  const { cart, error, errorCode, retry, clear, pending } = useCart();
  if (!error) return null;
  return <div role="alert" className="mx-auto my-5 max-w-6xl rounded-2xl border border-amber-300/30 bg-amber-300/5 p-5 text-amber-100">
    <p>{error}</p>
    <button type="button" className="cart-button mt-3" disabled={pending} onClick={() => void retry()}>Retry cart</button>
    {errorCode === 'CART_CURRENCY_MISMATCH' && !cart?.items.length && <button type="button" className="cart-button mt-3 ml-3" disabled={pending} onClick={() => void clear()}>Clear cart</button>}
  </div>;
}
