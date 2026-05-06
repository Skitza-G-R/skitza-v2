import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Fraunces, Outfit, Syne, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { PostHogProvider } from "~/components/observability/posthog-provider";
import { SwRegister } from "~/components/shell/sw-register";
import { ToastProvider } from "~/components/ui/toast";
import "./globals.css";

// Warm cream typography stack (Phase D).
// - Fraunces: variable-axis display serif (SOFT + opsz + WONK) — replaces
//   Syne. Used for all editorial headings via the `.font-display` utility.
// - Outfit: clean modern sans body. Default via CSS var.
// - JetBrains Mono: numerics + code — used via `.font-mono` utility.
//
// Each Next/font loader attaches a CSS variable on <html>. globals.css
// aliases the semantic names (`--font-display` etc.) to these, so every
// existing `var(--font-display)` / `var(--font-body)` consumer keeps
// working without renames.
//
// Landing-restore (S1, 2026-04-26) adds two more font variables:
// - `--font-body` → Outfit (weights 300/400/500/600) for landing body
//   text. Lives alongside `--font-outfit` (which the authed app uses)
//   so neither surface has to migrate.
// - `--font-head` → Syne (weights 700/800) for landing editorial
//   headings — the founder's signature display face. Used ONLY under
//   `.landing-root` (apps/web/src/styles/landing.css).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "opsz", "WONK"],
});
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});
const outfitBody = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});
const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-head",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://skitza.app"),
  title: {
    default: "Skitza — Business automation for music producers",
    template: "%s — Skitza",
  },
  description:
    "Stop chasing payments. Just make music. Skitza is the only link you need — clients book sessions, sign contracts, and pay automatically, and your final mixes stay locked until the invoice is cleared.",
  applicationName: "Skitza",
  authors: [{ name: "Skitza" }],
  keywords: [
    "music producer",
    "studio business",
    "booking automation",
    "session management",
    "invoice automation",
    "contract e-sign",
    "studio CRM",
    "producer storefront",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Skitza",
  },
  twitter: {
    card: "summary_large_image",
    title: "Skitza — Business automation for music producers",
    description:
      "Stop chasing payments. Just make music. Skitza is the only link you need.",
  },
};

// Viewport + theme-color — matches the warm cream body so the browser
// chrome blends in on mobile. :root is now light by default; dark mode
// is an opt-in flip via next-themes (Phase D).
//
// `viewportFit: "cover"` is required for iOS safe-area insets to
// resolve to non-zero values inside the notch / home-indicator zones;
// without it, `env(safe-area-inset-*)` reports 0 and our
// `.sk-safe-bottom` / `.sk-safe-top` utilities would be no-ops on PWA
// installs.
//
// `maximumScale: 5` + `userScalable: true` keep pinch-to-zoom enabled
// — WCAG 1.4.4 (Resize Text) requires that we don't block users from
// zooming to 200%+. We used to rely on the browser default, but being
// explicit future-proofs against a Next.js viewport default change.
export const viewport: Viewport = {
  themeColor: "#F4EFE7",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

// Clerk theming via `appearance.variables` so we don't add @clerk/themes.
// Hex values match the new :root (warm cream + amber). Clerk doesn't
// support rgb space-separated channel syntax in `variables`, so hex.
// NOTE: Clerk's appearance is static here — it doesn't track the
// next-themes toggle at runtime (Clerk initialises once). When dark
// mode lands fully, a client-side ClerkProvider wrapper keyed off the
// resolved theme would make these colours track. Minor; out of scope.
const clerkAppearance = {
  variables: {
    colorPrimary: "#C98A0A",
    colorBackground: "#FBF7F0",
    colorInputBackground: "#FBF7F0",
    colorInputText: "#1A1714",
    colorText: "#1A1714",
    colorTextSecondary: "#3D3730",
    colorNeutral: "#6B6158",
    colorDanger: "#B3321C",
    colorSuccess: "#3F7D4E",
    colorWarning: "#C98A0A",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
  },
  elements: {
    card: "bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] shadow-[var(--shadow-md)]",
    headerTitle: "font-display text-[rgb(var(--fg-primary))]",
    headerSubtitle: "text-[rgb(var(--fg-secondary))]",
    formButtonPrimary:
      "bg-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.9)] text-[rgb(var(--fg-inverse))] normal-case font-medium",
    footerActionText: "text-[rgb(var(--fg-secondary))]",
    footerActionLink:
      "text-[rgb(var(--brand-primary))] hover:text-[rgb(var(--brand-primary)/0.9)]",
    formFieldLabel: "text-[rgb(var(--fg-primary))]",
    identityPreviewText: "text-[rgb(var(--fg-primary))]",
    identityPreviewEditButton: "text-[rgb(var(--brand-primary))]",
  },
} as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  // Root layout intentionally pins `lang="en" dir="ltr"`. i18n is
  // scoped to the authenticated app surfaces ((app), (artist),
  // (artist-welcome), (onboarding)) — each of those layouts mounts its
  // own <NextIntlClientProvider> and wraps its content in a <div
  // dir={...}> so RTL only fires where it's wanted. The landing,
  // public storefront, sign-in/up, and the magic-link handler stay
  // English/LTR regardless of the NEXT_LOCALE cookie, matching the
  // "English is the universal default" product decision.
  return (
    <ClerkProvider appearance={clerkAppearance}>
      {/* `suppressHydrationWarning` stays on <html>: next-themes sets
          the `data-theme` attribute via an inline script before React
          hydrates, and React would otherwise warn on the resulting
          attribute mismatch. The warning is suppressed only on <html>,
          not on child elements. */}
      <html
        lang="en"
        dir="ltr"
        className={`${fraunces.variable} ${outfit.variable} ${outfitBody.variable} ${syne.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <body>
          {/* ThemeProvider owns the `data-theme` attribute on <html>.
              - `light: ""` → in light mode the attribute is empty so the
                 `:root` rules apply unmodified (no class conflict).
              - `dark:  "chrome-dark"` → matches the existing scoped
                 selector so dark-mode tokens apply globally.
              - `enableSystem` respects `prefers-color-scheme` on first
                 visit.
              - `disableTransitionOnChange` prevents mid-transition
                 flicker when flipping themes. */}
          <ThemeProvider
            attribute="data-theme"
            value={{ light: "", dark: "chrome-dark" }}
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            {/* Skip-to-content link — keyboard-only users hit Tab on page
                load, see this first, and jump past the shell navigation
                straight to the main content. */}
            <a href="#main-content" className="skip-to-content">
              Skip to content
            </a>
            {/* Registers the app-shell Service Worker — makes the
                installed Tauri Mac app feel near-native on repeat
                visits by serving the shell + Next.js chunks from
                cache. Fails open in unsupported environments. */}
            <SwRegister />
            {/* PostHog product analytics. Mounted INSIDE ClerkProvider
                so its identify-hook can read `useUser()` without a
                separate provider boundary. No-ops when
                NEXT_PUBLIC_POSTHOG_KEY is unset (dev / preview
                without secrets). 2026-04-22 — audit Task 14. */}
            <PostHogProvider>
              <ToastProvider>{children}</ToastProvider>
            </PostHogProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
