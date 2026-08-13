import type { Metadata, Viewport } from "next";

export const NATIVE_APP_NAME = "Skitza";
export const NATIVE_APP_DESCRIPTION =
  "The business workspace for independent music producers and their artists.";
export const NATIVE_APP_START_URL = "/launch";

export const nativeAppMetadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: NATIVE_APP_NAME,
    // Current iOS can expose an unpaintable fullscreen band to Home Screen
    // apps using `black-translucent`. The opaque dark status bar keeps the
    // web viewport below system chrome and the bottom navigation reachable.
    statusBarStyle: "black",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  icons: {
    icon: [
      {
        url: "/icons/skitza-16.png",
        type: "image/png",
        sizes: "16x16",
      },
      {
        url: "/icons/skitza-32.png",
        type: "image/png",
        sizes: "32x32",
      },
      {
        url: "/icons/skitza-48.png",
        type: "image/png",
        sizes: "48x48",
      },
      {
        url: "/icons/skitza-64.png",
        type: "image/png",
        sizes: "64x64",
      },
      {
        url: "/icons/skitza-128.png",
        type: "image/png",
        sizes: "128x128",
      },
      {
        url: "/icons/skitza-192.png",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/icons/skitza-256.png",
        type: "image/png",
        sizes: "256x256",
      },
      {
        url: "/icons/skitza-512.png",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon-180.png",
        type: "image/png",
        sizes: "180x180",
      },
    ],
    shortcut: [
      {
        url: "/icons/skitza-32.png",
        type: "image/png",
        sizes: "32x32",
      },
    ],
  },
} satisfies Pick<
  Metadata,
  "appleWebApp" | "formatDetection" | "icons" | "manifest"
>;

export const nativeAppViewport = {
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: "#F2EDE6",
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: "#111009",
    },
  ],
  colorScheme: "light dark",
} satisfies Pick<Viewport, "colorScheme" | "themeColor">;
