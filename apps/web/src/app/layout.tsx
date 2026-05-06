import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Outfit, Syne, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { PostHogProvider } from "~/components/observability/posthog-provider";
import { SwRegister } from "~/components/shell/sw-register";
import { ToastProvider } from "~/components/ui/toast";
import "./globals.css";

// Locked typography stack (v3-ui-design, 2026-05-05).
// - Syne 600/700/800: ALL editorial headings + the "Skitza." wordmark.
//   Surfaces the same `--font-syne` variable that globals.css aliases as
//   `--font-display`, `--font-head`, and the Tailwind `font-syne` utility.
// - Outfit 300-800: body, labels, descriptions. Surfaces `--font-outfit`
//   which globals.css aliases as `--font-body`.
// - JetBrains Mono 400/500/600/700: timestamps, prices, durations, IDs.
//   Always tabular-nums (the `font-mono` @utility in globals.css enables
//   `tnum` + `ss02` features).
//
// Fraunces — retired. The prior Phase D stack used Fraunces as the
// display serif; the locked spec replaces it with Syne (extrabold,
// tight tracking) per `notes/design-system.md`. globals.css repoints
// `--font-display` → `--font-syne` so existing `.font-display`
// consumers continue rendering without a per-file migration.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});
const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://skitza-v2-web.vercel.app"),
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
// chrome blends in on mobile. :root is light by default; dark mode is
// an opt-in flip via next-themes.
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
  themeColor: "#F2EDE6",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

// Clerk theming via `appearance.variables` — hex values mirror the
// locked design system tokens (#D4960A amber on #FFFFFF cards over the
// #F2EDE6 canvas). Clerk doesn't accept rgb space-separated channel
// syntax in `variables`, so each value is duplicated in hex form here.
// NOTE: Clerk initialises once with these values; a future client-side
// ClerkProvider wrapper could swap on next-themes toggle. Out of scope.
//
// Phase 3 (v3) — `elements` extended for the split-screen auth shell
// (`apps/web/src/app/(public)/(auth)/layout.tsx`). The card sits on
// the warm cream `bg-[rgb(var(--bg-base))]` of the FormColumn, so we:
// - keep the subtle border + shadow (an elevated card on warm cream
//   is the locked design's default surface treatment),
// - style the social buttons + divider + form fields explicitly so
//   they match the design source's split-screen mock without dropping
//   into Clerk Elements (Path A in `docs/qa/phase-3-handoff.md`),
// - use Syne for `headerTitle` (the "Welcome back." / "Build your
//   hall." copy is the most prominent text on the page).
const clerkAppearance = {
  variables: {
    colorPrimary: "#D4960A",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#111009",
    colorText: "#111009",
    colorTextSecondary: "#3D3730",
    colorNeutral: "#6B6359",
    colorDanger: "#DC2626",
    colorSuccess: "#22C55E",
    colorWarning: "#F59E0B",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
  },
  elements: {
    rootBox: "w-full",
    card: "bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] shadow-[var(--shadow-md)] rounded-[var(--radius-lg)]",
    headerTitle:
      "font-syne text-[28px] font-extrabold tracking-tight text-[rgb(var(--fg-primary))]",
    headerSubtitle:
      "text-[13.5px] leading-[1.5] text-[rgb(var(--fg-secondary))]",
    socialButtonsBlockButton:
      "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-overlay))]",
    socialButtonsBlockButtonText:
      "text-[13px] font-semibold text-[rgb(var(--fg-primary))]",
    socialButtonsProviderIcon: "h-4 w-4",
    dividerLine: "bg-[rgb(var(--border-subtle))]",
    dividerText:
      "text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]",
    formFieldLabel:
      "text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]",
    formFieldInput:
      "bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:ring-[rgb(var(--brand-primary)/0.15)]",
    formFieldErrorText: "text-[12px] text-[rgb(var(--fg-danger))]",
    formFieldSuccessText: "text-[12px] text-[rgb(var(--fg-success))]",
    formButtonPrimary:
      "bg-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.92)] text-white normal-case font-bold text-[13.5px] tracking-tight",
    footerActionText: "text-[12.5px] text-[rgb(var(--fg-secondary))]",
    footerActionLink:
      "text-[12.5px] font-bold text-[rgb(var(--brand-primary))] hover:text-[rgb(var(--brand-primary)/0.85)]",
    identityPreviewText: "text-[13px] text-[rgb(var(--fg-primary))]",
    identityPreviewEditButton:
      "text-[12px] font-semibold text-[rgb(var(--brand-primary))]",
    formResendCodeLink:
      "text-[12px] font-bold text-[rgb(var(--brand-primary))]",
    otpCodeFieldInput:
      "font-mono text-[22px] font-extrabold border border-[rgb(var(--border-subtle))] focus:border-[rgb(var(--brand-primary))]",
    alert:
      "bg-[rgb(var(--fg-danger)/0.08)] border border-[rgb(var(--fg-danger)/0.2)] text-[rgb(var(--fg-danger))]",
  },
} as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  // Root layout intentionally pins `lang="en" dir="ltr"`. i18n is
  // scoped to the authenticated app surfaces ((app), (artist),
  // (artist-welcome), (onboarding)) — each of those layouts mounts its
  // own <NextIntlClientProvider> and wraps its content in a <div
  // dir={...}> so RTL only fires where it's wanted. The landing,
  // public storefront, and sign-in/up stay English/LTR regardless of
  // the NEXT_LOCALE cookie, matching the "English is the universal
  // default" product decision.
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
        className={`${outfit.variable} ${syne.variable} ${jetbrainsMono.variable}`}
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
