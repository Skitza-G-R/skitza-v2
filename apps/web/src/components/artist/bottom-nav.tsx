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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/95 backdrop-blur"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-3 text-[0.66rem] font-mono uppercase tracking-wider transition-colors ${
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
