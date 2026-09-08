import { Hero } from '../components/hero';
import { Navbar } from '../components/navbar';
import { ProductGrid } from '../components/product-grid';
import { ProductStates } from '../components/product-states';
import { featuredProducts } from '../lib/catalog';

export default function Home() {
  return (
    <main id="top">
      <Navbar />
      <Hero />
      <section aria-labelledby="products-heading" className="px-5 pb-20 sm:px-8" id="products">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-emerald-300">The edit</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white" id="products-heading">
                Featured essentials
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-slate-400">A small local preview while the catalog connection takes shape.</p>
          </div>
          <ProductGrid products={featuredProducts} />
        </div>
      </section>
      <ProductStates />
      <footer className="border-t border-white/10 px-5 py-8 text-center text-sm text-slate-500 sm:px-8" id="about">
        Nexo Commerce · Everyday objects, better chosen.
      </footer>
    </main>
  );
}
