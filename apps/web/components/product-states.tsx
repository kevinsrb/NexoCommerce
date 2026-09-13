import type { StorefrontProduct } from '../lib/catalog';

import { ProductGrid } from './product-grid';

export type ProductState = 'ready' | 'loading' | 'empty' | 'error';

type ProductStatesProps = {
  state: ProductState;
  products: readonly StorefrontProduct[];
};

type StateCardProps = {
  title: string;
  description: string;
  icon: string;
  tone: 'default' | 'error';
};

const stateCards: Record<Exclude<ProductState, 'ready'>, StateCardProps> = {
  loading: {
    title: 'Loading products',
    description: 'Fetching the next thoughtful find.',
    icon: '…',
    tone: 'default',
  },
  empty: {
    title: 'Nothing here yet',
    description: 'Try a different collection or check back soon.',
    icon: '○',
    tone: 'default',
  },
  error: {
    title: "We couldn't load products",
    description: 'Please try again in a moment.',
    icon: '!',
    tone: 'error',
  },
};

function StateCard({ title, description, icon, tone }: StateCardProps) {
  const toneClass = tone === 'error' ? 'border-rose-300/30 bg-rose-300/10' : 'border-white/10 bg-white/[0.03]';

  return (
    <article className={`rounded-2xl border p-5 ${toneClass}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="mb-4 inline-flex size-8 items-center justify-center rounded-full bg-slate-950/60 text-sm font-semibold" aria-hidden="true">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </article>
  );
}

export function ProductStates({ state, products }: ProductStatesProps) {
  return (
    <section aria-labelledby="products-heading" className="border-t border-white/10 px-5 py-20 sm:px-8" id="products">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-emerald-300">The edit</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white" id="products-heading">
              Featured essentials
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-slate-400">A current selection from the Nexo catalog.</p>
        </div>
        <div id="states">
          {state === 'ready' ? <ProductGrid products={products} /> : <StateCard {...stateCards[state]} />}
        </div>
      </div>
    </section>
  );
}
