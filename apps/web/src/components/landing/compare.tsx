// Compare — DARK world. Table pitting Skitza against Samply, HoneyBook,
// Dubsado, and "A Google Doc". Mobile stacks as per-competitor cards so
// we never force a horizontal scroll on narrow screens.
export function Compare() {
  return (
    <section
      data-theme="chrome-dark"
      id="compare"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            Compare
          </p>
          <h2
            className="mt-3 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            The producer stack,
            <span className="block italic text-[rgb(var(--brand-primary))]">
              in one box.
            </span>
          </h2>
          <p className="mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
            Every other tool picks a lane. Skitza covers the full producer loop: find
            the work, sign the work, do the work, ship the work, get paid.
          </p>
        </div>

        {/* Desktop/tablet table */}
        <div className="mt-14 hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgb(var(--border-subtle))] text-left">
                <th className="p-4 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Capability
                </th>
                {COMPETITORS.map((c) => (
                  <th
                    key={c.name}
                    className={[
                      "p-4 text-center font-display tracking-tight",
                      c.highlight
                        ? "bg-[rgb(var(--brand-primary)/0.08)] text-[rgb(var(--brand-primary))]"
                        : "text-[rgb(var(--fg-primary))]",
                    ].join(" ")}
                    style={{ fontWeight: 700 }}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr
                  key={r.cap}
                  className="border-b border-[rgb(var(--border-subtle))] last:border-b-0"
                >
                  <td className="p-4 font-medium text-[rgb(var(--fg-primary))]">
                    {r.cap}
                  </td>
                  {r.cells.map((v, i) => (
                    <td
                      key={i}
                      className={[
                        "p-4 text-center",
                        COMPETITORS[i]?.highlight
                          ? "bg-[rgb(var(--brand-primary)/0.04)]"
                          : "",
                      ].join(" ")}
                    >
                      <Mark value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: per-competitor cards */}
        <div className="mt-10 grid gap-3 md:hidden">
          {COMPETITORS.map((c, ci) => (
            <article
              key={c.name}
              className={[
                "rounded-[var(--radius-lg)] border p-5",
                c.highlight
                  ? "border-[rgb(var(--brand-primary)/0.4)] bg-[rgb(var(--brand-primary)/0.06)]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
              ].join(" ")}
            >
              <h3
                className={[
                  "font-display text-xl tracking-tight",
                  c.highlight ? "text-[rgb(var(--brand-primary))]" : "",
                ].join(" ")}
                style={{ fontWeight: 700 }}
              >
                {c.name}
              </h3>
              <ul className="mt-3 space-y-1.5 text-sm">
                {ROWS.map((r) => (
                  <li key={r.cap} className="flex items-center justify-between gap-3">
                    <span className="text-[rgb(var(--fg-secondary))]">{r.cap}</span>
                    <Mark value={r.cells[ci] ?? "no"} />
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

type Cell = "yes" | "no" | "partial";

function Mark({ value }: { value: Cell }) {
  if (value === "yes") {
    return (
      <span
        aria-label="Included"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span
        aria-label="Partial"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(var(--brand-accent)/0.5)] text-[rgb(var(--brand-accent))]"
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-label="Not included"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-muted))]"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 6l12 12M6 18L18 6" />
      </svg>
    </span>
  );
}

const COMPETITORS: readonly { name: string; highlight?: boolean }[] = [
  { name: "Skitza", highlight: true },
  { name: "Samply" },
  { name: "HoneyBook" },
  { name: "Dubsado" },
  { name: "A Google Doc" },
];

const ROWS: readonly { cap: string; cells: readonly Cell[] }[] = [
  { cap: "Kanban pipeline",     cells: ["yes", "no",      "yes",     "yes",     "no"] },
  { cap: "Audio review & stems", cells: ["yes", "yes",     "no",      "no",      "no"] },
  { cap: "Contracts + e-sign",   cells: ["yes", "no",      "yes",     "yes",     "no"] },
  { cap: "Booking + deposits",   cells: ["yes", "no",      "yes",     "yes",     "no"] },
  { cap: "Client CRM",           cells: ["yes", "no",      "yes",     "yes",     "partial"] },
  { cap: "Desktop app",          cells: ["yes", "yes",     "no",      "no",      "no"] },
  { cap: "Open-source API",      cells: ["yes", "no",      "no",      "no",      "no"] },
  { cap: "One URL for everything", cells: ["yes", "no",    "partial", "partial", "no"] },
];
