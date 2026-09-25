'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CartItem } from '../lib/cart';
import { CartError, useCart } from './cart-provider';

function CartLine({ item }: { item: CartItem }) {
  const { pending, update, remove } = useCart();
  const [quantity, setQuantity] = useState(String(item.quantity));
  const value = Number(quantity);
  const validQuantity = Number.isSafeInteger(value) && value >= 1;
  return <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">{item.productName}</h2>
        <p className="mt-1 text-sm text-slate-400">{item.variantName} · {item.currency} {item.price} each</p>
      </div>
      <p>{item.currency} {item.subtotal}</p>
    </div>
    <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (validQuantity) void update(item.variantId, value);
    }}>
      <label className="grid gap-2 text-sm text-slate-300">
        Quantity<span className="sr-only"> for {item.productName}</span>
        <input className="w-24 rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-white" type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} required value={quantity} disabled={pending} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <button className="cart-button" type="submit" aria-label={`Update ${item.productName} quantity`} disabled={pending || !validQuantity}>Update</button>
      <button className="cart-button" type="button" aria-label={`Remove ${item.productName}`} disabled={pending} onClick={() => void remove(item.variantId)}>Remove</button>
    </form>
  </li>;
}

export function CartPage() {
  const { cart, loading, pending, clear } = useCart();
  return <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Your cart</h1>
      <Link className="text-sm text-emerald-200 hover:underline" href="/#products">Continue shopping</Link>
    </div>
    <CartError />
    {loading ? <p role="status" className="text-slate-400">Loading your cart…</p> : cart && (
      cart.items.length === 0 ? <section className="rounded-3xl border border-white/10 p-8">
        <h2 className="text-xl font-semibold">Your cart is empty</h2>
        <p className="mt-2 text-slate-400">Discover something for your everyday.</p>
      </section> : <section aria-label="Cart contents" aria-busy={pending}>
        <ul className="grid gap-4" aria-label="Cart items">
          {cart.items.map((item) => <CartLine key={`${item.variantId}:${item.quantity}`} item={item} />)}
        </ul>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <button className="cart-button" type="button" disabled={pending} onClick={() => void clear()}>Clear cart</button>
          <p className="text-xl font-semibold" aria-label="Cart total">Total: {cart.currency} {cart.total}</p>
        </div>
        {pending && <p role="status" className="mt-4 text-sm text-slate-400">Updating your cart…</p>}
      </section>
    )}
  </main>;
}
