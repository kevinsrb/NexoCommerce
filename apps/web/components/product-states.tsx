type StateCardProps = {
  title: string;
  description: string;
  tone: 'loading' | 'empty' | 'error';
};

function StateCard({ title, description, tone }: StateCardProps) {
  const icon = tone === 'loading' ? '…' : tone === 'empty' ? '○' : '!';
  const toneClass =
    tone === 'error' ? 'border-rose-300/30 bg-rose-300/10 text-rose-100' : 'border-white/10 bg-white/[0.03]';

  return (
    <article className={`rounded-2xl border p-5 ${toneClass}`}>
      <span className="mb-4 inline-flex size-8 items-center justify-center rounded-full bg-slate-950/60 text-sm font-semibold" aria-hidden="true">
        {icon}
      </span>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </article>
  );
}

export function ProductStates() {
  return (
    <section aria-labelledby="states-heading" className="border-t border-white/10 px-5 py-20 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-emerald-300">Designed for real moments</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white" id="states-heading">
          A considered catalog experience.
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <StateCard title="Loading products" description="Fetching the next thoughtful find." tone="loading" />
          <StateCard title="Nothing here yet" description="Try a different collection or check back soon." tone="empty" />
          <StateCard title="We couldn't load products" description="Please try again in a moment." tone="error" />
        </div>
      </div>
    </section>
  );
}
