"use client";

import { useState } from "react";

// Features section — DARK world. 7-tab interactive feature browser.
// Matches index.html §4.
//
// Each tab's pane renders a static mockup + copy. The mockups are
// simplified vs. the landing's full composed illustrations (those are
// Phase B polish); the copy is verbatim.

const TABS = [
  {
    key: "booking",
    label: "Storefront & Booking",
    title: "Sell packages, not just time.",
    body: [
      `Share your Skitza link as your personal storefront. Clients select a service (e.g. "Full Production"), pick a date, and pay the deposit — all in one flow.`,
      `No more "does Thursday at 4 work?"`,
    ],
    MockupNode: BookingMockup,
  },
  {
    key: "payments",
    label: "Payments on autopilot",
    title: "Payments on autopilot",
    body: [
      "Clients pay the deposit when they book — no invoice needed.",
      "A contract is sent automatically and signed before the session.",
      "After the session, the balance is collected without you asking.",
      "Money in. No chasing. No awkward follow-ups.",
    ],
    MockupNode: PaymentsMockup,
  },
  {
    key: "files",
    label: "Files & Feedback",
    title: "Stream freely. Download when paid.",
    body: [
      `Clients can listen to the latest mix and leave timestamped feedback. "Fix the snare at 1:42" stays at 1:42.`,
      "The high-res download button? That stays securely locked until the final invoice is paid.",
    ],
    MockupNode: FilesMockup,
  },
  {
    key: "crm",
    label: "Client history",
    title: "Client Management",
    body: [
      "Every client's history, sessions, payments, notes, and files in one place.",
      "Know who's coming back, who owes you, and who sent you three referrals.",
    ],
    MockupNode: CrmMockup,
  },
  {
    key: "followup",
    label: "Follow-up on autopilot",
    title: "Follow-up on autopilot",
    body: [
      "Booking confirmations, session reminders, post-session thank-yous, payment nudges — sent via WhatsApp or email, in your voice.",
      "Clients feel taken care of. You didn't lift a finger.",
    ],
    MockupNode: FollowupMockup,
  },
  {
    key: "leads",
    label: "Lead Management",
    title: "Lead Management",
    body: [
      "Someone DMs and goes quiet? Skitza tracks the lead, sends automated follow-ups, and tells you exactly when to reach back out.",
      "Your pipeline, managed.",
    ],
    MockupNode: LeadsMockup,
  },
  {
    key: "contracts",
    label: "Contracts & Protection",
    title: "Zero disputes. Guaranteed.",
    body: [
      "Don't start a session without a signature. Skitza generates custom copyright agreements and split sheets that clients digitally sign right from their phone.",
      "Your final files remain securely locked until the balance is completely cleared.",
    ],
    MockupNode: ContractsMockup,
  },
] as const;

export function FeaturesTabs() {
  const [active, setActive] = useState(0);
  // `TABS` is a non-empty const tuple so [0] is always defined; fall
  // back to [0] if `active` ever drifts out of range via stale state.
  const current = TABS[active] ?? TABS[0];

  return (
    <section
      data-theme="chrome-dark"
      id="features"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-3xl">
          <span
            aria-hidden
            className="block font-display text-[clamp(4rem,10vw,8rem)] leading-none opacity-[0.04]"
            style={{ fontWeight: 800 }}
          >
            03
          </span>
          <p className="mt-[-3rem] font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
            What Skitza does
          </p>
          <h2
            className="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
            style={{ fontWeight: 800 }}
          >
            Your studio.
            <span className="block">On autopilot.</span>
          </h2>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
          {/* Tab list */}
          <nav aria-label="Feature list" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setActive(i);
                }}
                aria-pressed={active === i}
                className={[
                  "whitespace-nowrap rounded-[var(--radius-md)] px-4 py-3 text-left text-sm transition-colors",
                  active === i
                    ? "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--fg-primary))] border border-[rgb(var(--brand-primary)/0.35)] font-semibold"
                    : "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] border border-[rgb(var(--border-subtle))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Active tab pane */}
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 sm:p-8">
            <h3
              className="font-display text-2xl leading-tight tracking-tight text-[rgb(var(--fg-primary))] sm:text-3xl"
              style={{ fontWeight: 700 }}
            >
              {current.title}
            </h3>
            {current.body.map((line, i) => (
              <p
                key={i}
                className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))] sm:text-base"
              >
                {line}
              </p>
            ))}
            <div className="mt-8">
              <current.MockupNode />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────── Mockups (static visual representations) ─────────

function BookingMockup() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 font-mono text-xs">
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--bg-elevated))] px-3 py-2">
        <div>
          <div className="font-semibold text-[rgb(var(--brand-primary))]">Full Production Package</div>
          <div className="mt-0.5 text-[rgb(var(--fg-muted))]">Beat · tracking · mix</div>
        </div>
        <div className="font-display text-sm" style={{ fontWeight: 700 }}>$1,500</div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
          <div key={d} className="py-1 text-center text-[10px] text-[rgb(var(--fg-muted))]">
            {d}
          </div>
        ))}
        {["10am", "10am", "10am", "10am", "10am"].map((t, i) => (
          <div
            key={`r1-${String(i)}`}
            className="rounded-[2px] bg-[rgb(var(--bg-elevated))] py-1 text-center text-[10px] text-[rgb(var(--fg-secondary))]"
          >
            {t}
          </div>
        ))}
        {["1pm", "1pm", "1pm", "1pm", "1pm"].map((t, i) => (
          <div
            key={`r2-${String(i)}`}
            className="rounded-[2px] bg-[rgb(var(--bg-elevated))] py-1 text-center text-[10px] text-[rgb(var(--fg-secondary))]"
          >
            {t}
          </div>
        ))}
        {[
          { t: "4pm" },
          { t: "3pm", on: true },
          { t: "4pm" },
          { t: "4pm" },
          { t: "4pm" },
        ].map((cell, i) => (
          <div
            key={`r3-${String(i)}`}
            className={[
              "rounded-[2px] py-1 text-center text-[10px]",
              cell.on
                ? "bg-[rgb(var(--brand-primary))] text-[#0C0A07] font-semibold"
                : "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]",
            ].join(" ")}
          >
            {cell.t}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2 text-[rgb(var(--fg-primary))]">
        <span>Marcus T. · 2hr session · $150 deposit paid</span>
        <span className="text-[rgb(var(--brand-primary))]">✓</span>
      </div>
    </div>
  );
}

function PaymentsMockup() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 font-mono text-xs">
      <div className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
        <div className="flex items-center justify-between">
          <span>Invoice #0042 · Marcus T.</span>
          <span className="rounded-full border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-2 py-0.5 text-[10px] text-[rgb(var(--brand-primary))]">
            Paid ✓
          </span>
        </div>
        <div className="mt-2 flex justify-between text-[rgb(var(--fg-secondary))]"><span>Recording 2hr</span><span>$300</span></div>
        <div className="flex justify-between text-[rgb(var(--fg-secondary))]"><span>Mix revision</span><span>$150</span></div>
        <div className="mt-1 flex justify-between border-t border-[rgb(var(--border-subtle))] pt-1 font-semibold"><span>Total</span><span>$450</span></div>
      </div>
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-[rgb(var(--fg-secondary))]">
          <span>#0043 · Alex D.</span>
          <span className="text-[rgb(var(--brand-primary))]">Pending</span>
        </div>
        <div className="flex items-center justify-between text-[rgb(var(--fg-secondary))]">
          <span>#0041 · Jordan S.</span>
          <span className="text-[rgb(var(--brand-accent))]">Overdue</span>
        </div>
      </div>
    </div>
  );
}

function FilesMockup() {
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4">
      <div className="rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 text-[10px] font-mono">
          {["Mix V3 (Current)", "Mix V2 (Approved)", "Mix V1"].map((v, i) => (
            <span
              key={v}
              className={[
                "whitespace-nowrap rounded px-2 py-0.5",
                i === 0
                  ? "border border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] font-semibold"
                  : "border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-muted))]",
              ].join(" ")}
            >
              {v}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm font-medium">Draft_v3_unreleased.wav</p>
        <div className="relative mt-2 h-2 w-full rounded-full bg-[rgb(var(--bg-base))]">
          <div className="absolute left-0 top-0 h-full w-[42%] rounded-full bg-[rgb(var(--brand-primary))]" />
        </div>
        <div className="mt-3 rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] p-2 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-[rgb(var(--fg-muted))]">1:42</span>
            <span className="text-[10px] uppercase tracking-wide text-[rgb(var(--brand-primary))]">✓ Resolved</span>
          </div>
          <p className="mt-0.5 text-[rgb(var(--fg-secondary))]">&ldquo;Snare too loud here&rdquo;</p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 text-xs">
        <div>
          <p className="font-medium text-[rgb(var(--fg-primary))]">Final Mix + Stems.zip</p>
          <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">Ready for download · 450MB</p>
        </div>
        <div className="text-right">
          <span className="inline-flex cursor-not-allowed items-center gap-1 rounded border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-3 py-1 font-mono text-xs text-[rgb(var(--fg-muted))]">
            <svg aria-hidden viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
            Download
          </span>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-[rgb(var(--brand-accent))]">
            Unlocks after $150 payment
          </p>
        </div>
      </div>
    </div>
  );
}

function CrmMockup() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] font-display text-sm text-[#0C0A07]" style={{ fontWeight: 800 }}>
          MT
        </div>
        <div className="font-display text-lg tracking-tight" style={{ fontWeight: 700 }}>Marcus T.</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-mono">
        {["8 sessions", "$3,200 total", "2 referrals"].map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2.5 py-1 text-[rgb(var(--fg-secondary))]"
          >
            {chip}
          </span>
        ))}
      </div>
      <div className="mt-4 space-y-2 text-xs">
        {["Session booked · 2 days ago", "Invoice paid · 5 days ago", "Files delivered · 1 week ago"].map((e) => (
          <div key={e} className="flex items-center gap-2 text-[rgb(var(--fg-secondary))]">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--brand-primary))]" />
            {e}
          </div>
        ))}
      </div>
    </div>
  );
}

function FollowupMockup() {
  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 text-xs">
      {[
        { from: "left", text: "Hey Marcus, your session is confirmed for Tuesday at 3pm." },
        { from: "left", text: "Your files are ready — click here to download" },
        { from: "right", text: "Perfect, thanks!" },
      ].map((b, i) => (
        <div
          key={i}
          className={[
            "max-w-[85%] rounded-[var(--radius-md)] px-3 py-2",
            b.from === "left"
              ? "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]"
              : "ml-auto bg-[rgb(var(--brand-primary)/0.15)] text-[rgb(var(--fg-primary))]",
          ].join(" ")}
        >
          {b.text}
        </div>
      ))}
      <p className="mt-2 text-center font-mono text-[10px] italic text-[rgb(var(--fg-muted))]">
        Sent automatically by Skitza
      </p>
    </div>
  );
}

function LeadsMockup() {
  // Widened item type so "active" and "dim" are both legal flags across
  // every card regardless of which ones are actually set — avoids
  // `as const`'s narrow union making the in-operator check deterministic.
  type LeadCard = { name: string; sub: string; active?: boolean; dim?: boolean };
  const COLS: readonly { title: string; items: readonly LeadCard[] }[] = [
    { title: "New", items: [{ name: "Sarah J.", sub: "DM inquiry · Today" }, { name: "Jay K.", sub: "Instagram DM", dim: true }] },
    {
      title: "Following Up",
      items: [{ name: "Marcus T.", sub: "Rates sent · auto-follow-up", active: true }, { name: "Dana R.", sub: "No reply · 3 days", dim: true }],
    },
    { title: "Booked", items: [{ name: "Alex D.", sub: "Deposit paid", dim: true }, { name: "Mia L.", sub: "Session confirmed", dim: true }] },
  ];
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4">
      <div className="grid grid-cols-3 gap-2">
        {COLS.map((col) => (
          <div key={col.title} className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">{col.title}</div>
            {col.items.map((card) => (
              <div
                key={card.name}
                className={[
                  "rounded-[var(--radius-sm)] border bg-[rgb(var(--bg-elevated))] p-2 text-xs",
                  card.active
                    ? "border-[rgb(var(--brand-primary)/0.5)]"
                    : "border-[rgb(var(--border-subtle))]",
                  card.dim ? "opacity-60" : "",
                ].join(" ")}
              >
                <div className="font-medium text-[rgb(var(--fg-primary))]">{card.name}</div>
                <div className="mt-0.5 font-mono text-[10px] text-[rgb(var(--fg-muted))]">{card.sub}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[rgb(var(--border-subtle))] pt-2 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
        <span>6 active leads</span>
        <span className="text-[rgb(var(--brand-primary))]">2 need follow-up</span>
      </div>
    </div>
  );
}

function ContractsMockup() {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-4 sm:flex-row">
      <div
        className="flex-1 rounded-[var(--radius-sm)] bg-[#F2EDE6] p-3 text-[#1A1714] shadow-[0_10px_30px_-8px_rgb(0_0_0_/_0.4)]"
        style={{ transform: "rotate(-2deg)" }}
      >
        <div className="border-b border-black pb-1 text-center text-[10px] font-bold" style={{ fontFamily: "Times, serif" }}>
          Master Agreement
        </div>
        <p className="mt-2 text-[9px] leading-relaxed" style={{ fontFamily: "Times, serif" }}>
          Artist agrees to the 50% publishing split and acknowledges files remain securely locked until the balance is cleared.
        </p>
        <div className="mt-3 border-t border-dashed border-[#ccc] pt-2">
          <div className="text-[8px] uppercase tracking-widest text-[#666]">Artist Signature</div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span
              className="text-base italic text-[#0015ff]"
              style={{ fontFamily: "'Brush Script MT', cursive", transform: "rotate(-3deg)", display: "inline-block" }}
            >
              Marcus T.
            </span>
            <span className="rounded bg-[#27ae60] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
              Verified
            </span>
          </div>
        </div>
      </div>
      <div
        className="flex flex-1 flex-col items-center justify-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-center shadow-[0_10px_30px_-8px_rgb(0_0_0_/_0.3)]"
        style={{ transform: "rotate(1deg)" }}
      >
        <svg aria-hidden viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[rgb(var(--brand-primary))]">
          <path d="M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" />
        </svg>
        <div className="mt-1 text-xs font-medium">Final_Master.wav</div>
        <span className="mt-3 inline-flex items-center gap-1 rounded border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--brand-primary)/0.08)] px-3 py-1 font-mono text-xs text-[rgb(var(--fg-muted))]">
          🔒 Download
        </span>
        <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
          Unlocks after $150 final payment
        </p>
      </div>
    </div>
  );
}
