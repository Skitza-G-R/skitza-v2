// Consolidation — DARK world. "Cancel the rest." 9 tools replaced + 3
// stat pills. Matches index.html §5.

export function Consolidation() {
  return (
    <section
      data-theme="chrome-dark"
      id="consolidation"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-5xl px-6 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          One tool. Full stop.
        </p>
        <h2
          className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          Cancel the rest.
          <span className="block">Skitza is the only</span>
          <span className="block">tab you need open.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[rgb(var(--fg-secondary))]">
          Most producers juggle multiple tools that barely talk to each other. Skitza
          replaces all of them — one subscription, one login, one place where everything
          just works.
        </p>

        <div className="mt-14 grid gap-3 sm:grid-cols-3">
          {[
            { num: "9+", label: "tools replaced" },
            { num: "1", label: "subscription" },
            { num: "0", label: "new apps to learn" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-6 py-8"
            >
              <p
                className="font-display text-5xl leading-none text-[rgb(var(--brand-primary))]"
                style={{ fontWeight: 800 }}
              >
                {s.num}
              </p>
              <p className="mt-2 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                {s.label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {TOOLS.map((t) => (
            <span
              key={t.name}
              className={[
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs",
                t.skitza
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] line-through",
              ].join(" ")}
            >
              <span aria-hidden>{t.icon}</span> {t.name}
            </span>
          ))}
        </div>
        <p className="mt-6 font-mono text-xs text-[rgb(var(--fg-muted))]">
          One subscription. One login. Zero context-switching.
        </p>
      </div>
    </section>
  );
}

type Tool = { icon: string; name: string; skitza?: boolean };
const TOOLS: readonly Tool[] = [
  { icon: "💬", name: "WhatsApp" },
  { icon: "🔗", name: "Linktree" },
  { icon: "✍️", name: "DocuSign" },
  { icon: "📤", name: "WeTransfer" },
  { icon: "📊", name: "Google Sheets" },
  { icon: "💸", name: "PayPal" },
  { icon: "📁", name: "Google Drive" },
  { icon: "📧", name: "Gmail drafts" },
  { icon: "📅", name: "Calendly" },
  { icon: "⚡", name: "Skitza", skitza: true },
];
