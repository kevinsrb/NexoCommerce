import { Hero } from '../components/hero';
import { Navbar } from '../components/navbar';
import { ProductCatalog } from '../components/product-catalog';
import { CartError } from '../components/cart-provider';

export default function Home() {
  return (
    <main id="top">
      <Navbar />
      <CartError />
      <Hero />
      <ProductCatalog />
      <footer className="border-t border-white/10 px-5 py-8 text-center text-sm text-slate-500 sm:px-8" id="about">
        Nexo Commerce · Everyday objects, better chosen.
      </footer>
    </main>
  );
}
