// Social links rendering — Spotify / YouTube / Instagram / SoundCloud
// chips on the dark CTA section at the bottom of `/join/<slug>`.
//
// Per design context 2026: small pill-style chips with platform name +
// a tiny icon, sitting next to the primary "Book a session →" CTA.
// On dark theme, pills are 1px solid border with cream text at low
// opacity. Hovering brightens the border.
//
// The data shape comes from `producer_external_links` (migration 0031).
// `platform` is a free-form string; the UI maps the common ones to
// human-readable labels but renders unknown platforms as-is.
//
// Server component — pure render. Plain `<a target="_blank">` with the
// `rel="noopener noreferrer"` safety pair so opening the link can't
// leak window.opener references back to the producer's catalog page.

interface SocialLink {
  id: string;
  platform: string;
  url: string;
  title: string | null;
  position: number;
}

interface JoinSocialLinksProps {
  links: ReadonlyArray<SocialLink>;
}

const PLATFORM_LABELS: Record<string, string> = {
  spotify: "Spotify",
  youtube: "YouTube",
  instagram: "Instagram",
  instagram_reels: "Instagram",
  soundcloud: "SoundCloud",
  apple_music: "Apple Music",
  bandcamp: "Bandcamp",
  tiktok: "TikTok",
};

function labelFor(link: SocialLink): string {
  if (link.title && link.title.trim().length > 0) {
    return link.title.trim();
  }
  const fallback = PLATFORM_LABELS[link.platform];
  if (fallback) return fallback;
  // Unknown platform — show the host portion of the URL as a sensible
  // last resort. URL parsing is wrapped in try/catch because the schema
  // doesn't enforce well-formed URLs.
  try {
    const parsed = new URL(link.url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return link.platform;
  }
}

export function JoinSocialLinks({ links }: JoinSocialLinksProps) {
  const filtered = links.filter((l) => l.url && l.url.trim().length > 0);
  if (filtered.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
      {filtered.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={[
              "inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-md)]",
              "border border-[rgb(var(--fg-inverse)/0.2)] px-4 py-2.5",
              "text-xs font-semibold text-[rgb(var(--fg-inverse))]",
              "transition-colors hover:border-[rgb(var(--fg-inverse)/0.45)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
            ].join(" ")}
          >
            <PlatformIcon platform={link.platform} className="h-3 w-3" />
            {labelFor(link)}
          </a>
        </li>
      ))}
    </ul>
  );
}

// Tiny platform glyphs, inline. Generic music-note for unknown platforms.
function PlatformIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const wrap = (children: React.ReactNode) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
      {children}
    </svg>
  );
  switch (platform) {
    case "instagram":
    case "instagram_reels":
      return wrap(
        <>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" y1="6.5" x2="17.5" y2="6.5" />
        </>,
      );
    case "youtube":
      return wrap(
        <>
          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
          <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
        </>,
      );
    case "soundcloud":
      return wrap(
        <>
          <path d="M3 17v-4M6 17v-6M9 17v-8M12 17V8M15 17V7" />
          <path d="M16 11a4 4 0 1 1 4 6h-4z" />
        </>,
      );
    case "spotify":
    case "apple_music":
    case "bandcamp":
    case "tiktok":
    default:
      // Generic music note glyph for music platforms or unknown.
      return wrap(
        <>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </>,
      );
  }
}
