export function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28">
      <div className="absolute left-1/2 top-0 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-300/10 blur-3xl" />
      <div className="mx-auto max-w-6xl text-center">
        <p className="mb-5 text-sm font-medium uppercase tracking-[0.22em] text-emerald-300">
          Thoughtful things, simply found
        </p>
        <h1 className="mx-auto max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-7xl">
          Commerce that feels effortless.
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
          A curated collection of useful objects for the pace you want to keep.
        </p>
        <a
          className="mt-9 inline-flex rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
          href="#products"
        >
          Discover the collection
        </a>
      </div>
    </section>
  );
}
