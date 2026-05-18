// Wave 2 S04 Part 2 — external-links section for /join/<slug> page.
// PRD §6.2 Section B. Renders producer-curated external streaming links
// below the Skitza-uploaded Section A samples. Links come in render
// order from publicProfile.forJoin (sorted by `position`).

import type { ExternalPlatform } from "@skitza/db";

import { ExternalLinkEmbed } from "~/components/embeds/ExternalLinkEmbed";

export type ExternalLinkRow = {
  id: string;
  platform: ExternalPlatform;
  url: string;
  title: string | null;
  position: number;
};

interface Props {
  links: readonly ExternalLinkRow[];
}

export function ExternalLinksSection({ links }: Props) {
  // Empty producers: hide the whole section. No visual noise when there's
  // nothing to show. Producer ships a clean hero + sample tracks and
  // nothing else — exactly what they'd want if they haven't curated links.
  if (links.length === 0) return null;

  return (
    <section
      aria-labelledby="join-external-links-heading"
      className="mt-10"
    >
      <header className="mb-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Also on
        </p>
        <h2
          id="join-external-links-heading"
          className="mt-1 font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
        >
          More places to listen
        </h2>
      </header>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.id}>
            <ExternalLinkEmbed
              platform={link.platform}
              url={link.url}
              title={link.title}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
