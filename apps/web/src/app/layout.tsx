import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Syne, Outfit } from "next/font/google";

import { ToastProvider } from "~/components/ui/toast";
import "./globals.css";

// Warm cream typography stack (Phase A).
// - Syne: distinctive geometric display face (700/800). Used for all
//   editorial headings via the `.font-display` utility.
// - Outfit: clean modern sans body (300–600). Default via CSS var.
// - Mono: system stack (no branded mono — reduces font weight).
const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  display: "swap",
  variable: "--font-display",
});
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-body",
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
// chrome blends in on mobile. :root is now light by default.
export const viewport: Viewport = {
  themeColor: "#F2EDE6",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

// Clerk theming via `appearance.variables` so we don't add @clerk/themes.
// Hex values match the new :root (warm cream + amber). Clerk doesn't
// support rgb space-separated channel syntax in `variables`, so hex.
const clerkAppearance = {
  variables: {
    colorPrimary: "#D4960A",
    colorBackground: "#FFFBF5",
    colorInputBackground: "#FFFBF5",
    colorInputText: "#1A1714",
    colorText: "#1A1714",
    colorTextSecondary: "#6B6560",
    colorNeutral: "#6B6560",
    colorDanger: "#CC3A2E",
    colorSuccess: "#468C46",
    colorWarning: "#D4960A",
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
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html
        lang="en"
        className={`${syne.variable} ${outfit.variable}`}
      >
        <body>
          {/* Skip-to-content link — keyboard-only users hit Tab on page
              load, see this first, and jump past the shell navigation
              straight to the main content. */}
          <a href="#main-content" className="skip-to-content">
            Skip to content
          </a>
          <ToastProvider>{children}</ToastProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
