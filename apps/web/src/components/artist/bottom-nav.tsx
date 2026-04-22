"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/artist", label: "Home", icon: "🏠" },
  { href: "/artist/music", label: "Music", icon: "🎵" },
  { href: "/artist/book", label: "Book", icon: "🗓️" },
  { href: "/artist/store", label: "Store", icon: "🛍️" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  // "Home" is the only path that needs an exact match; the others
  // light up on any descendant route (e.g. /artist/music/abc123).
  const isActive = (href: string) =>
    href === "/artist" ? pathname === "/artist" : pathname.startsWith(href);

  return (
    <nav
      role="navigation"
      aria-label="Artist app tabs"
      // `sk-safe-bottom` pads the iOS home-indicator inset inside the
      // nav (not below it) so the tab icons themselves clear the gesture
      // strip on iPhone PWAs. `sk-safe-x` keeps side-landscape notches
      // from clipping the first/last tab label.
      // Hidden on desktop (md+) — the ArtistSidebar replaces bottom nav.
      className="sk-safe-bottom sk-safe-x fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                // min-h-[56px] exceeds the 44×44 Apple minimum and
                // matches the visual weight of iOS native tab bars
                // (UITabBar is 49pt high). focus-visible ring is
                // inset so the outline doesn't clip at the nav's top
                // border.
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 py-2 text-[0.66rem] font-mono uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))] ${
                  active
                    ? "text-[rgb(var(--brand-primary))]"
                    : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-secondary))]"
                }`}
              >
                <span aria-hidden className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
