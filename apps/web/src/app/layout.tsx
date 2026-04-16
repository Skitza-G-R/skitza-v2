import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

// Studio Monitor typography stack.
// - Fraunces: variable serif with optical-size axis — editorial headline face.
// - IBM Plex Sans: body workhorse; less cliché than Inter.
// - IBM Plex Mono: technical labels (UIDs, tokens, keyboard shortcuts).
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
  variable: "--font-display",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata = {
  title: {
    default: "Skitza — the studio in one link",
    template: "%s — Skitza",
  },
  description:
    "Skitza is the all-in-one studio business platform for independent music producers: booking, contracts, portfolio, collaboration, and smart lead links — in one tool.",
};

// Clerk theming via `variables` keeps us off @clerk/themes (no new dep).
// Values are hex because Clerk's CSS variables don't accept rgb space-separated channel syntax.
const clerkAppearance = {
  variables: {
    colorPrimary: "#22c55e",
    colorBackground: "#0b0b0d",
    colorInputBackground: "#16161a",
    colorInputText: "#f5f4f0",
    colorText: "#f5f4f0",
    colorTextSecondary: "#a8a6a0",
    colorNeutral: "#a8a6a0",
    colorDanger: "#ef4444",
    colorSuccess: "#22c55e",
    colorWarning: "#eab308",
    borderRadius: "0.5rem",
    fontFamily: "var(--font-body)",
    fontFamilyButtons: "var(--font-body)",
  },
  elements: {
    card: "bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] shadow-none",
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
        className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}
      >
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
