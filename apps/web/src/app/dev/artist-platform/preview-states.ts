import type { ArtistPlatformPreviewDestination } from "~/components/dev/artist-platform-preview-shell";

type ArtistPlatformPreviewStateBase = Readonly<{
  label: string;
  href: string;
  detail: string;
}>;

export type ArtistPlatformPreviewState =
  | (ArtistPlatformPreviewStateBase &
      Readonly<{
        chrome: "Standing";
        activeDestination: ArtistPlatformPreviewDestination;
      }>)
  | (ArtistPlatformPreviewStateBase &
      Readonly<{
        chrome: "Focused";
        activeDestination: null;
      }>);

export type ArtistPlatformPreviewGroup = Readonly<{
  label: string;
  states: readonly ArtistPlatformPreviewState[];
}>;

export const ARTIST_PLATFORM_PREVIEW_GROUPS: readonly ArtistPlatformPreviewGroup[] = [
  {
    label: "Platform",
    states: [
      {
        label: "Home",
        href: "/dev/screens/artist-home",
        chrome: "Standing",
        activeDestination: "home",
        detail: "Priority action, new music, and quiet supporting work.",
      },
      {
        label: "Store catalog",
        href: "/dev/screens/artist-store",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Studio identity, focal service, and supporting catalog.",
      },
      {
        label: "Sessions",
        href: "/dev/screens/artist-sessions",
        chrome: "Standing",
        activeDestination: "sessions",
        detail: "Upcoming studio time and a bounded, expandable history.",
      },
      {
        label: "Session detail",
        href: "/dev/screens/artist-session-detail",
        chrome: "Standing",
        activeDestination: "sessions",
        detail: "Exact booking, dual timezone, and change policy.",
      },
      {
        label: "Settings",
        href: "/dev/screens/artist-settings",
        chrome: "Standing",
        activeDestination: "settings",
        detail: "Profile, preferences, timezone, and studio history.",
      },
      {
        label: "Notification center",
        href: "/dev/screens/artist-notifications",
        chrome: "Standing",
        activeDestination: "notifications",
        detail: "Unread feed, count badge, and per-studio activity dots.",
      },
    ],
  },
  {
    label: "Music and history",
    states: [
      {
        label: "Music library lifecycle",
        href: "/dev/screens/artist-library-lifecycle",
        chrome: "Standing",
        activeDestination: "music",
        detail: "Active, completed, and canceled projects.",
      },
      {
        label: "Completed project",
        href: "/dev/screens/artist-project-completed",
        chrome: "Standing",
        activeDestination: "music",
        detail: "Read-only historical project access.",
      },
      {
        label: "Canceled project",
        href: "/dev/screens/artist-project-canceled",
        chrome: "Standing",
        activeDestination: "music",
        detail: "Canceled project history with retained music.",
      },
    ],
  },
  {
    label: "Store and request",
    states: [
      {
        label: "Product detail",
        href: "/dev/screens/s3",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Unified service detail and request entry.",
      },
      {
        label: "Active purchase guard",
        href: "/dev/screens/s3-pending",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Continuation replaces a second purchase.",
      },
      {
        label: "Request details",
        href: "/dev/screens/s3-request",
        chrome: "Focused",
        activeDestination: null,
        detail: "Short project-target request step.",
      },
      {
        label: "Review and accept",
        href: "/dev/screens/s4",
        chrome: "Focused",
        activeDestination: null,
        detail: "Exact commercial terms and acceptance.",
      },
      {
        label: "Request sent",
        href: "/dev/screens/s5",
        chrome: "Focused",
        activeDestination: null,
        detail: "Producer-review waiting state.",
      },
      {
        label: "Choose payment plan",
        href: "/dev/screens/s7",
        chrome: "Focused",
        activeDestination: null,
        detail: "Approved payment-plan choice.",
      },
    ],
  },
  {
    label: "Off-app payment",
    states: [
      {
        label: "Bank / Bit instructions",
        href: "/dev/screens/s8",
        chrome: "Focused",
        activeDestination: null,
        detail: "Compact studio payment instructions.",
      },
      {
        label: "Upload proof",
        href: "/dev/screens/s9",
        chrome: "Focused",
        activeDestination: null,
        detail: "One locked installment proof upload.",
      },
      {
        label: "Awaiting verification",
        href: "/dev/screens/s9-awaiting",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Submitted proof record.",
      },
      {
        label: "Proof rejected",
        href: "/dev/screens/s9-rejected",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Producer note and replacement action.",
      },
      {
        label: "Partially verified",
        href: "/dev/screens/s9-partial",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Payment summary with the next installment ready.",
      },
      {
        label: "Next installment scheduled",
        href: "/dev/screens/s9-scheduled",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Payment summary before the final payment trigger is reached.",
      },
      {
        label: "Fully verified",
        href: "/dev/screens/s9-paid",
        chrome: "Standing",
        activeDestination: "store",
        detail: "Completed payment summary.",
      },
    ],
  },
];

export function findArtistPlatformPreviewState(
  screen: string,
): ArtistPlatformPreviewState | undefined {
  const href = screen.startsWith("/dev/screens/") ? screen : `/dev/screens/${screen}`;
  for (const group of ARTIST_PLATFORM_PREVIEW_GROUPS) {
    const state = group.states.find((candidate) => candidate.href === href);
    if (state) return state;
  }
  return undefined;
}
