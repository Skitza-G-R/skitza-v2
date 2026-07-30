export const CORE_PORTFOLIO_PLATFORMS = ["spotify", "youtube", "instagram_reels"] as const;

export const ADDITIONAL_PORTFOLIO_PLATFORMS = ["soundcloud", "bandcamp"] as const;

export const ONBOARDING_PORTFOLIO_PLATFORMS = [
  ...CORE_PORTFOLIO_PLATFORMS,
  ...ADDITIONAL_PORTFOLIO_PLATFORMS,
] as const;

export type OnboardingPortfolioPlatform = (typeof ONBOARDING_PORTFOLIO_PLATFORMS)[number];

export interface InitialPortfolioLink {
  platform: string;
  url: string;
  title: string | null;
}

export interface PortfolioLinkRow {
  id: string;
  type: OnboardingPortfolioPlatform;
  url: string;
  title: string;
}

export const PORTFOLIO_PLATFORM_META: Record<
  OnboardingPortfolioPlatform,
  {
    label: string;
    placeholder: string;
    color: string;
  }
> = {
  spotify: {
    label: "Spotify",
    placeholder: "https://open.spotify.com/artist/…",
    color: "#1DB954",
  },
  youtube: {
    label: "YouTube",
    placeholder: "https://youtube.com/@yourhandle",
    color: "#FF0033",
  },
  instagram_reels: {
    label: "Instagram",
    placeholder: "https://instagram.com/yourhandle",
    color: "#E4405F",
  },
  soundcloud: {
    label: "SoundCloud",
    placeholder: "https://soundcloud.com/artist/track",
    color: "#FF5500",
  },
  bandcamp: {
    label: "Bandcamp",
    placeholder: "https://artist.bandcamp.com/track/…",
    color: "#408294",
  },
};

function isOnboardingPortfolioPlatform(platform: string): platform is OnboardingPortfolioPlatform {
  return (ONBOARDING_PORTFOLIO_PLATFORMS as readonly string[]).includes(platform);
}

function rowForPlatform(
  platform: OnboardingPortfolioPlatform,
  saved: InitialPortfolioLink | undefined,
): PortfolioLinkRow {
  return {
    id: `link-${platform}`,
    type: platform,
    url: saved?.url ?? "",
    title: saved?.title ?? "",
  };
}

/**
 * Spotify, YouTube, and Instagram are always present. SoundCloud and
 * Bandcamp appear when already saved, or when the producer adds them.
 * Other valid DB platforms are deliberately omitted from this compact
 * onboarding surface; because the save payload also omits them, Continue
 * cannot delete those untouched rows.
 */
export function initialPortfolioRows(
  initialLinks: readonly InitialPortfolioLink[],
): PortfolioLinkRow[] {
  const savedByPlatform = new Map<OnboardingPortfolioPlatform, InitialPortfolioLink>();

  for (const link of initialLinks) {
    if (isOnboardingPortfolioPlatform(link.platform) && !savedByPlatform.has(link.platform)) {
      savedByPlatform.set(link.platform, link);
    }
  }

  return [
    ...CORE_PORTFOLIO_PLATFORMS.map((platform) =>
      rowForPlatform(platform, savedByPlatform.get(platform)),
    ),
    ...ADDITIONAL_PORTFOLIO_PLATFORMS.flatMap((platform) => {
      const saved = savedByPlatform.get(platform);
      return saved ? [rowForPlatform(platform, saved)] : [];
    }),
  ];
}

export function nextAvailablePortfolioPlatform(
  rows: readonly PortfolioLinkRow[],
): OnboardingPortfolioPlatform | null {
  const used = new Set(rows.map((row) => row.type));
  return ONBOARDING_PORTFOLIO_PLATFORMS.find((platform) => !used.has(platform)) ?? null;
}

export function onboardingPortfolioUrlError(
  platform: OnboardingPortfolioPlatform,
  rawUrl: string,
): string | null {
  const url = rawUrl.trim();
  if (url === "") return null;
  const label = PORTFOLIO_PLATFORM_META[platform].label;
  if (detectPlatform(url) !== platform) {
    return `Paste a valid ${label} link starting with http:// or https://.`;
  }
  return null;
}

/**
 * Send one entry for each onboarding-supported platform. Empty entries make
 * an explicit removal safe, while platforms outside this onboarding surface
 * are absent and therefore remain untouched.
 */
export function toOnboardingPortfolioPayload(rows: readonly PortfolioLinkRow[]): {
  links: Array<{
    platform: OnboardingPortfolioPlatform;
    url: string;
    title: string;
  }>;
} {
  const byPlatform = new Map(rows.map((row) => [row.type, row]));

  return {
    links: ONBOARDING_PORTFOLIO_PLATFORMS.map((platform) => {
      const row = byPlatform.get(platform);
      return {
        platform,
        url: row?.url.trim() ?? "",
        title: row?.title.trim() ?? "",
      };
    }),
  };
}
import { detectPlatform } from "~/lib/external-links/detect-platform";
