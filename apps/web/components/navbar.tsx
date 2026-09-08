const navigationItems = [
  { href: '#products', label: 'Shop' },
  { href: '#states', label: 'Experience' },
  { href: '#about', label: 'About' },
] as const;

export function Navbar() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-5 sm:px-8">
        <a className="text-lg font-semibold tracking-tight" href="#top" aria-label="Nexo Commerce home">
          NEXO<span className="text-emerald-300">.</span>
        </a>
        <nav aria-label="Primary navigation">
          <ul className="flex items-center gap-4 text-sm text-slate-300 sm:gap-7">
            {navigationItems.map(({ href, label }) => (
              <li key={href}>
                <a className="transition hover:text-emerald-200" href={href}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a
          className="hidden rounded-full border border-white/15 px-4 py-2 text-sm font-medium transition hover:border-emerald-300 hover:text-emerald-200 sm:inline-flex"
          href="#products"
        >
          Explore
        </a>
      </div>
    </header>
  );
}
