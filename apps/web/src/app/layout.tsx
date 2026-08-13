import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Outfit, Syne, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";

import { SkipToContent } from "~/components/a11y/skip-to-content";
import { AppMediaRuntime } from "~/components/audio/app-media-runtime";
import { nativeThemeProviderProps } from "~/components/native/native-theme";
import { NativeViewportSync } from "~/components/native/native-viewport";
import { PostHogProvider } from "~/components/observability/posthog-provider";
import { NativeAppRuntime } from "~/components/shell/sw-register";
import { ToastProvider } from "~/components/ui/toast";
import { nativeAppMetadata, nativeAppViewport } from "~/lib/pwa/native-app-metadata";
import "./globals.css";

// Locked typography stack (v3-ui-design, 2026-05-05).
// - Syne 600/700/800: ALL editorial headings + the "Skitza." wordmark.
//   Surfaces the same `--font-syne` variable that globals.css aliases as
//   `--font-display`, `--font-head`, and the Tailwind `font-syne` utility.
// - Outfit 300-800: body, labels, descriptions. Surfaces `--font-outfit`
//   which globals.css aliases as `--font-body`.
// - JetBrains Mono 400/500/600/700/800: timestamps, prices, durations, IDs.
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
  weight: ["400", "500", "600", "700", "800"],
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
    "Clients, projects, audio review, bookings, agreements, external-payment records, and optional Google Calendar sync for solo music producers.",
  applicationName: "Skitza",
  authors: [{ name: "Skitza" }],
  keywords: [
    "music producer",
    "studio business",
    "booking automation",
    "session management",
    "external payment records",
    "music agreements",
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
    description: "Stop chasing payments. Just make music. Skitza is the only link you need.",
  },
  ...nativeAppMetadata,
};

// Viewport + theme-color — nativeAppViewport keeps mobile browser chrome
// aligned with the active light/dark system theme.
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
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  ...nativeAppViewport,
};

// Clerk theming via `appearance.variables`. Full CSS color expressions keep
// Clerk's secure prebuilt flow on the same semantic token boundary as the
// surrounding app. Because these expressions resolve where Clerk renders,
// auth recovery/verification/error steps follow the saved/system theme
// without a client-only ClerkProvider wrapper.
//
// Phase 3 (v3) — `elements` extended for the split-screen auth shell
// (`apps/web/src/app/(public)/(auth)/layout.tsx`). The locked design
// (`/tmp/skitza-design/tabs/auth.jsx`) keeps Clerk's internals intact while
// the route shell supplies the page-level title and layout.
// The hero copy ("Welcome back.", "Build your hall.") is provided by
// `apps/web/src/components/auth/auth-hero.tsx`, which sits ABOVE the
// `<SignIn>` / `<SignUp>` widget on each page. Therefore:
// - `card` stays explicitly bounded on desktop; the sign-in shell removes
//   only its phone chrome so it reads as one native surface,
// - `header` is hidden so Clerk's default "Sign in" / "Create your
//   account" titles don't double up with the AuthHero,
// - everything else (social buttons, divider, form fields, primary
//   button, OTP, alerts) inherits the locked palette so the visible
//   internals still match the design source.
const clerkAppearance = {
  variables: {
    colorPrimary: "rgb(var(--brand-primary))",
    colorBackground: "rgb(var(--bg-elevated))",
    colorInputBackground: "rgb(var(--bg-elevated))",
    colorInputText: "rgb(var(--fg-default))",
    colorText: "rgb(var(--fg-default))",
    colorTextSecondary: "rgb(var(--fg-secondary))",
    colorNeutral: "rgb(var(--fg-muted))",
    colorDanger: "rgb(var(--fg-danger))",
    colorSuccess: "rgb(var(--fg-success))",
    colorWarning: "rgb(var(--fg-warning))",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
  },
  elements: {
    rootBox: "w-full",
    card: "rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)]",
    // Hide Clerk's default header — AuthHero replaces it.
    header: "hidden",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    socialButtonsBlockButton:
      "sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-overlay))]",
    socialButtonsBlockButtonText: "text-[13px] font-semibold text-[rgb(var(--fg-primary))]",
    socialButtonsProviderIcon: "h-4 w-4",
    dividerLine: "bg-[rgb(var(--border-subtle))]",
    dividerText:
      "text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]",
    formFieldLabel: "text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]",
    formFieldInput:
      "min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] text-[rgb(var(--fg-primary))] focus:border-[rgb(var(--brand-primary))] focus:ring-[rgb(var(--brand-primary)/0.15)]",
    formFieldErrorText: "text-[12px] text-[rgb(var(--fg-danger))]",
    formFieldSuccessText: "text-[12px] text-[rgb(var(--fg-success))]",
    formButtonPrimary:
      "sk-press min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] hover:bg-[rgb(var(--brand-primary)/0.92)] text-[rgb(var(--fg-on-brand))] normal-case font-bold text-[13.5px] tracking-tight",
    footerActionText: "text-[12.5px] text-[rgb(var(--fg-secondary))]",
    footerActionLink:
      "text-[12.5px] font-bold text-[rgb(var(--brand-primary))] hover:text-[rgb(var(--brand-primary)/0.85)]",
    identityPreviewText: "text-[13px] text-[rgb(var(--fg-primary))]",
    identityPreviewEditButton: "text-[12px] font-semibold text-[rgb(var(--brand-primary))]",
    formResendCodeLink: "text-[12px] font-bold text-[rgb(var(--brand-primary))]",
    otpCodeFieldInput:
      "font-mono text-[22px] font-extrabold border border-[rgb(var(--border-subtle))] [--sk-mobile-control-font-size:22px] focus:border-[rgb(var(--brand-primary))]",
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
          {/* System theme is the first-visit default. The existing theme
              toggle remains a persisted explicit light/dark override. */}
          <ThemeProvider {...nativeThemeProviderProps}>
            {/* Synchronizes iOS Visual Viewport and keyboard-safe CSS
                variables before any app shell content mounts. */}
            <NativeViewportSync />
            {/* Skip-to-content link — keyboard-only users hit Tab on page
                load, see this first, and jump past the shell navigation
                straight to the main content. */}
            <SkipToContent />
            {/* Registers the install/update runtime. Only versioned static
                assets and explicit public resources are cacheable; private
                app data remains network-only. */}
            <NativeAppRuntime />
            <AppMediaRuntime />
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
