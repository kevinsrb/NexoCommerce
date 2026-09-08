import { Hero } from '../components/hero';
import { Navbar } from '../components/navbar';
import { ProductStates } from '../components/product-states';
import { featuredProducts } from '../lib/catalog';

export default function Home() {
  return (
    <main id="top">
      <Navbar />
      <Hero />
      <ProductStates products={featuredProducts} state="ready" />
      <footer className="border-t border-white/10 px-5 py-8 text-center text-sm text-slate-500 sm:px-8" id="about">
        Nexo Commerce · Everyday objects, better chosen.
      </footer>
    </main>
  );
}
