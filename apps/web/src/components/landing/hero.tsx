import Link from "next/link";

import { SkitzaMark } from "~/components/brand/skitza-mark";

// Hero — LIGHT world. Opens the page. "Sign up free" is the single
// conversion moment; "Download for Mac" anchors to the download section
// below for visitors who want the desktop binary first.
//
// Anatomy: brand mark → label → headline (Fraunces, italic color-break
// on line 2) → sub-copy → CTA pair → trust microcopy → product mockup
// (CSS-built Kanban-on-light) → trust line. Ambient drifting blobs
// behind everything.
export function Hero() {
  return (
    <header
      id="main-content"
      className="relative overflow-hidden pb-20 pt-12 sm:pb-28 sm:pt-20"
    >
      {/* Ambient amber + copper drift blobs. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <span
          className="absolute left-[-12%] top-[-8rem] h-[36rem] w-[36rem] rounded-full blur-[100px]"
          style={{
            background: "rgba(212,150,10,0.10)",
            animation: "skitza-drift 25s ease-in-out infinite alternate",
          }}
        />
        <span
          className="absolute right-[-10%] top-[30%] h-[30rem] w-[30rem] rounded-full blur-[100px]"
          style={{
            background: "rgba(176,104,48,0.10)",
            animation: "skitza-drift 30s ease-in-out -5s infinite alternate",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
        <div className="reveal-up mx-auto inline-flex items-center justify-center">
          <SkitzaMark size="hero" />
        </div>

        <p className="reveal-up-delay-1 mt-6 font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          The studio around the work
        </p>

        <h1
          className="reveal-up-delay-2 mt-6 font-display text-[clamp(2.75rem,8vw,5rem)] leading-[0.98] tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 800 }}
        >
          Run your producer business
          <span className="mt-1 block italic text-[rgb(var(--brand-primary))]">
            like you run a session.
          </span>
        </h1>

        <p className="reveal-up-delay-3 mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[rgb(var(--fg-secondary))] sm:text-xl">
          Skitza is the CRM, audio collaboration, booking, and contract tool built
          for solo music producers. One URL. Every client. Every session. Every bounce.
        </p>

        <div className="reveal-up-delay-4 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="pulse-glow inline-flex min-h-12 w-full items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-7 py-3.5 text-base font-semibold text-[#0C0A07] shadow-[0_6px_20px_-4px_rgb(var(--brand-primary)/0.4)] transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px] sm:w-auto"
          >
            Start free →
          </Link>
          <a
            href="#download"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-6 py-3.5 text-base font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-sunken))] sm:w-auto"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              className="-ml-0.5"
            >
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Download for Mac
          </a>
        </div>

        <p className="mt-4 font-mono text-xs text-[rgb(var(--fg-muted))]">
          Free forever. No card. Cancel anytime.
        </p>

        {/* Product mockup — CSS-built Kanban + sidebar glimpse, pointer-
            events-none, visual only. Built to reflect the actual dashboard
            look: warm cream canvas, amber accent header, status chips. */}
        <div
          aria-hidden
          className="pointer-events-none mx-auto mt-14 w-full max-w-4xl select-none"
          style={{
            animation: "skitza-reveal-up 0.9s cubic-bezier(0.16,1,0.3,1) both",
            animationDelay: "0.5s",
          }}
        >
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 shadow-[0_30px_80px_-24px_rgb(0_0_0/0.2)] sm:p-4">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F44] opacity-60" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#FA0] opacity-60" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#4C4] opacity-60" />
              <span className="ml-3 font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
                skitza · studio
              </span>
            </div>
            <div className="grid gap-3 rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] p-3 sm:grid-cols-[10rem_1fr]">
              {/* Sidebar */}
              <aside className="hidden flex-col gap-1.5 sm:flex">
                {[
                  { label: "Pipeline", active: true },
                  { label: "Audio" },
                  { label: "Clients" },
                  { label: "Calendar" },
                  { label: "Contracts" },
                  { label: "Inbox" },
                ].map((i) => (
                  <div
                    key={i.label}
                    className={[
                      "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs",
                      i.active
                        ? "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                        : "text-[rgb(var(--fg-secondary))]",
                    ].join(" ")}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                    {i.label}
                  </div>
                ))}
              </aside>

              {/* Kanban */}
              <div className="grid grid-cols-3 gap-2 text-left">
                {KANBAN.map((col) => (
                  <div key={col.title} className="min-w-0 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-elevated))] p-2">
                    <div className="flex items-center justify-between pb-2">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                        {col.title}
                      </span>
                      <span className="font-mono text-[9px] text-[rgb(var(--fg-muted))]">
                        {col.count}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {col.cards.map((c) => (
                        <div
                          key={c.name}
                          className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-2"
                        >
                          <p className="truncate text-[10px] font-medium text-[rgb(var(--fg-primary))]">
                            {c.name}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-[rgb(var(--fg-muted))]">
                            {c.sub}
                          </p>
                          {c.chip ? (
                            <span
                              className={[
                                "mt-1.5 inline-flex rounded-full px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-widest",
                                c.chip === "signed"
                                  ? "bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--brand-primary))]"
                                  : c.chip === "paid"
                                    ? "bg-[rgb(61_125_78/0.15)] text-[rgb(61_125_78)]"
                                    : "bg-[rgb(var(--brand-accent)/0.15)] text-[rgb(var(--brand-accent))]",
                              ].join(" ")}
                            >
                              {c.chip}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-8 font-mono text-xs text-[rgb(var(--fg-muted))]">
          Built in public · open-source core · made for producers who ship
        </p>
      </div>
    </header>
  );
}

// Hero mockup data. Deliberately specific names + amounts so the card
// reads like a real pipeline, not Lorem Ipsum. `chip` stays nullable so
// the Lead column's leading cards can render chip-free.
type KanbanChip = "signed" | "paid" | "review";
type KanbanCard = { name: string; sub: string; chip?: KanbanChip };
type KanbanCol = { title: string; count: string; cards: readonly KanbanCard[] };

const KANBAN: readonly KanbanCol[] = [
  {
    title: "Lead",
    count: "3",
    cards: [
      { name: "Sarah J.", sub: "DM inquiry · today" },
      { name: "Jay K.", sub: "IG · rates sent" },
    ],
  },
  {
    title: "Booked",
    count: "2",
    cards: [
      { name: "Marcus T.", sub: "Tue 3pm · 2hr", chip: "signed" },
      { name: "Alex D.", sub: "Fri · mix rev", chip: "paid" },
    ],
  },
  {
    title: "Delivery",
    count: "1",
    cards: [
      { name: "Mia L.", sub: "Stems · v3", chip: "review" },
    ],
  },
];
