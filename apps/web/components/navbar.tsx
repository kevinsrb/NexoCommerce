'use client';

import Link from 'next/link';
import { useCart } from './cart-provider';

const navigationItems = [
  { href: '/#products', label: 'Shop' },
  { href: '/#states', label: 'Experience' },
  { href: '/#about', label: 'About' },
] as const;

export function Navbar() {
  const { cart } = useCart();
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link className="text-lg font-semibold tracking-tight" href="/" aria-label="Nexo Commerce home">
          NEXO<span className="text-emerald-300">.</span>
        </Link>
        <nav aria-label="Primary navigation">
          <ul className="flex items-center gap-4 text-sm text-slate-300 sm:gap-7">
            {navigationItems.map(({ href, label }) => (
              <li key={href}>
                <Link className="transition hover:text-emerald-200" href={href}>
                  {label}
                </Link>
              </li>
            ))}
            <li><Link className="text-emerald-200 hover:underline" href="/cart">Cart <span aria-live="polite">({cart?.itemCount ?? 0})</span></Link></li>
          </ul>
        </nav>
        <Link
          className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-medium transition hover:border-emerald-300 hover:text-emerald-200 sm:inline-flex"
          href="/#products"
        >
          Explore
        </Link>
      </div>
    </header>
  );
}
