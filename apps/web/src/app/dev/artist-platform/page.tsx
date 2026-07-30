import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { ARTIST_PLATFORM_PREVIEW_GROUPS } from "./preview-states";

export const metadata: Metadata = {
  title: "Artist platform approval preview",
};

export default function ArtistPlatformPreviewIndex() {
  if (!isDevGalleryAvailable()) notFound();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[960px] px-4 py-8 sm:px-7 sm:py-12">
      <header className="max-w-[680px]">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-text))] uppercase">
          SK-153 · approval preview
        </p>
        <h1 className="font-display mt-2 text-[clamp(2rem,7vw,3.6rem)] leading-[0.98] font-extrabold tracking-[-0.045em] text-[rgb(var(--fg-default))]">
          Professional artist platform
        </h1>
        <p className="mt-4 max-w-[60ch] text-[14px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          Deterministic fake-data states for visual approval. No sign-in or database is used by
          these previews.
        </p>
      </header>

      <div className="mt-9 space-y-8">
        {ARTIST_PLATFORM_PREVIEW_GROUPS.map((group) => (
          <section key={group.label} aria-labelledby={group.label.replaceAll(" ", "-")}>
            <h2
              id={group.label.replaceAll(" ", "-")}
              className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase"
            >
              {group.label}
            </h2>
            <ul className="mt-3 grid list-none gap-2.5 sm:grid-cols-2">
              {group.states.map((state) => (
                <li key={state.href}>
                  <Link
                    href={state.href}
                    prefetch={false}
                    className="sk-press flex h-full min-h-[104px] items-start justify-between gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 hover:border-[rgb(var(--border-control))]"
                  >
                    <span>
                      <span className="block text-[14px] font-bold text-[rgb(var(--fg-default))]">
                        {state.label}
                      </span>
                      <span className="mt-1.5 block text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                        {state.detail}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[8px] font-bold tracking-[0.08em] text-[rgb(var(--fg-secondary))] uppercase">
                      {state.chrome}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
