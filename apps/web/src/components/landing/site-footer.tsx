import Link from "next/link";

import { SkitzaMark } from "~/components/brand/skitza-mark";

// Site footer — LIGHT world. Sits at the bottom of the landing. Four
// columns on desktop, two on mobile. Social links route to `#` until the
// owner fills in real URLs — marked as TODO so they're easy to find.
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((l) =>
                  l.kind === "route" ? (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--brand-primary))]"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...(l.external
                          ? { target: "_blank", rel: "noreferrer noopener" }
                          : {})}
                        className="text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--brand-primary))]"
                      >
                        {l.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-6 border-t border-[rgb(var(--border-subtle))] pt-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <SkitzaMark size="sm" />
            <div>
              <p
                className="font-display text-base tracking-tight text-[rgb(var(--fg-primary))]"
                style={{ fontWeight: 700 }}
              >
                Skitza
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                Made in the studio
              </p>
            </div>
          </div>

          <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            © {String(year)} Skitza · All rights reserved
          </p>
        </div>
      </div>
    </footer>
  );
}

type FooterLink =
  | { kind: "route"; label: string; href: "/about" | "/privacy" | "/terms" | "/changelog" | "/sign-in" | "/sign-up" }
  | { kind: "anchor"; label: string; href: string; external?: boolean };

const COLUMNS: readonly { title: string; links: readonly FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { kind: "anchor", label: "Features", href: "/#features" },
      { kind: "anchor", label: "Pricing", href: "/#pricing" },
      { kind: "route", label: "Changelog", href: "/changelog" },
      { kind: "anchor", label: "Download", href: "/#download" },
      { kind: "anchor", label: "Roadmap", href: "/#faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { kind: "route", label: "About", href: "/about" },
      // TODO: swap # for real blog / careers / contact routes
      { kind: "anchor", label: "Blog", href: "#" },
      { kind: "anchor", label: "Careers", href: "#" },
      { kind: "anchor", label: "Contact", href: "mailto:hello@skitza.app" },
    ],
  },
  {
    title: "Legal",
    links: [
      { kind: "route", label: "Privacy", href: "/privacy" },
      { kind: "route", label: "Terms", href: "/terms" },
      // TODO: add /cookies route when a full cookie policy is written
      { kind: "anchor", label: "Cookies", href: "#" },
    ],
  },
  {
    title: "Social",
    links: [
      // TODO: replace # with real social URLs
      { kind: "anchor", label: "Twitter / X", href: "#", external: true },
      { kind: "anchor", label: "Instagram", href: "#", external: true },
      {
        kind: "anchor",
        label: "GitHub",
        href: "https://github.com/giasraf/skitza-v2",
        external: true,
      },
      { kind: "anchor", label: "Discord", href: "#", external: true },
    ],
  },
];
