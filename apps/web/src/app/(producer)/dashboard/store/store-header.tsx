// store-header.tsx
//
// Top of the page: eyebrow CATALOG + Store. wordmark + counts line.
// Wordmark size scales between mobile and desktop so the design holds
// on phones (the handoff specs ~120px which only fits desktop).

interface StoreHeaderProps {
  liveCount: number;
  hiddenCount: number;
}

export function StoreHeader({ liveCount, hiddenCount }: StoreHeaderProps) {
  return (
    <header className="mb-6">
      <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        CATALOG
      </p>
      <h1
        className="mt-2 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
        style={{ fontSize: "clamp(56px, 14vw, 120px)" }}
      >
        Store<span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="mt-3 text-[14px] text-[rgb(var(--fg-muted))]">
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{liveCount}</span>{" "}
        live{" "}
        <span aria-hidden className="opacity-50">·</span>{" "}
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{hiddenCount}</span>{" "}
        hidden
      </p>
    </header>
  );
}
