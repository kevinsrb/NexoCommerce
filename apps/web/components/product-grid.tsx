import type { StorefrontProduct } from '../lib/catalog';

type ProductGridProps = {
  products: readonly StorefrontProduct[];
};

export function ProductGrid({ products }: ProductGridProps) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {products.map((product) => (
        <article
          className="group rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition hover:-translate-y-1 hover:border-emerald-300/40"
          key={product.name}
        >
          <div className={`mb-5 h-52 rounded-2xl bg-gradient-to-br ${product.accent} p-5`} aria-hidden="true">
            <span className="inline-flex rounded-full bg-slate-950/70 px-3 py-1 text-xs font-medium text-white">
              {product.category}
            </span>
          </div>
          <div className="px-1 pb-2">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">{product.name}</h3>
              <p className="text-sm font-medium text-emerald-200">{product.price}</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">{product.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
