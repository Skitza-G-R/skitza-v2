// Sticky top nav for `/join/<slug>`.
//
// SK-28: stripped to just the Skitza wordmark on the left. The slug
// pill, anchor links, and "Book a session" CTA were removed because
// they were noise on a single-screen public page — the visitor isn't
// in the app yet, has no surfaces to navigate to from here, and the
// bento's own primary CTA is always visible. The wordmark is the only
// piece of brand chrome that earns its place: it both anchors identity
// and gives the visitor a way back to skitza.app.

import Link from "next/link";

export function JoinNav() {
  return (
    <nav
      aria-label="Page navigation"
      className={[
        "sticky top-0 z-40 border-b border-[rgb(var(--fg-primary)/0.06)]",
        "bg-[rgb(var(--bg-base)/0.82)] backdrop-blur-md",
      ].join(" ")}
    >
      <div className="mx-auto flex max-w-6xl items-center px-4 py-2 sm:px-8 sm:py-2.5 lg:px-10">
        <Link
          href="/"
          className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))] transition-colors duration-300 hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:underline"
        >
          <span aria-hidden>← </span>Skitza.
        </Link>
      </div>
    </nav>
  );
}
