import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { JetBrains_Mono, Outfit, Syne } from "next/font/google";

import "./globals.css";

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

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Skitza Admin",
    template: "%s — Skitza Admin",
  },
  description: "Private Skitza founder operations.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

const clerkAppearance = {
  variables: {
    colorPrimary: "#d4960a",
    colorBackground: "#ffffff",
    colorInputBackground: "#ffffff",
    colorInputText: "#111009",
    colorText: "#111009",
    colorTextSecondary: "#6b6359",
    colorDanger: "#b42318",
    borderRadius: "0.75rem",
    fontFamily: "var(--font-body)",
  },
  elements: {
    card: "border border-[#e8e1d4] shadow-[0_18px_50px_rgba(17,16,9,0.08)]",
    formButtonPrimary: "rounded-[12px] bg-[#111009] text-white hover:bg-[#2b2924]",
    footerActionLink: "font-semibold text-[#8b5f00]",
  },
} as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance} signInUrl="/sign-in" afterSignOutUrl="/sign-in">
      <html lang="en" dir="ltr">
        <body className={`${outfit.variable} ${syne.variable} ${jetBrainsMono.variable}`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
