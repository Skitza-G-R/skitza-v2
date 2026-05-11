// store-header.tsx
//
// Top of the page: eyebrow CATALOG + Store. wordmark + counts line.
// Wordmark sized to feel distinctive but not dominate a sparse catalog.
// The handoff specs ~120px in a standalone prototype (no sidebar);
// inside the producer app shell that ends up overpowering the cards
// when the catalog is small. Scaled to ~88px desktop.

interface StoreHeaderProps {
  liveCount: number;
  hiddenCount: number;
}

export function StoreHeader({ liveCount, hiddenCount }: StoreHeaderProps) {
  return (
    <header className="mb-5">
      <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        CATALOG
      </p>
      <h1
        className="mt-1.5 font-display font-extrabold leading-[0.96] tracking-[-0.035em] text-[rgb(var(--fg-default))]"
        style={{ fontSize: "clamp(42px, 8.5vw, 88px)" }}
      >
        Store<span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="mt-2.5 text-[13px] text-[rgb(var(--fg-muted))]">
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{liveCount}</span>{" "}
        live{" "}
        <span aria-hidden className="opacity-50">·</span>{" "}
        <span className="font-semibold text-[rgb(var(--fg-default))] tabular-nums">{hiddenCount}</span>{" "}
        hidden
      </p>
    </header>
  );
}
