import Link from "next/link";

// Final CTA — LIGHT world. Last conversion moment on the page. Single
// primary button into sign-up, with a quieter download link for visitors
// who want the Mac app instead.
export function FinalCTA() {
  return (
    <section className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute left-1/2 top-1/3 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full blur-[120px]"
          style={{ background: "rgba(212,150,10,0.12)" }}
        />
      </div>
      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Ready when you are
        </p>
        <h2
          className="mt-4 font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[1] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          Start your free
          <span className="mt-1 block italic text-[rgb(var(--brand-primary))]">
            Skitza account.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[rgb(var(--fg-secondary))]">
          No card needed. Cancel anytime. Your booking URL is live the moment
          you sign up.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="pulse-glow inline-flex min-h-12 w-full items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] px-7 py-3.5 text-base font-semibold text-[#0C0A07] shadow-[0_6px_20px_-4px_rgb(var(--brand-primary)/0.4)] transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px] sm:w-auto"
          >
            Start free →
          </Link>
          <a
            href="#download"
            className="font-mono text-sm text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--brand-primary))]"
          >
            or download for Mac →
          </a>
        </div>
      </div>
    </section>
  );
}
