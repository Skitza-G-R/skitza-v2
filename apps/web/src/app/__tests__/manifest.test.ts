import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import manifest from "../manifest";
import {
  nativeAppMetadata,
  nativeAppViewport,
} from "~/lib/pwa/native-app-metadata";

const ICON_DIMENSIONS = [
  ["skitza-16.png", 16],
  ["skitza-32.png", 32],
  ["skitza-48.png", 48],
  ["skitza-64.png", 64],
  ["skitza-128.png", 128],
  ["apple-touch-icon-180.png", 180],
  ["skitza-192.png", 192],
  ["skitza-maskable-192.png", 192],
  ["skitza-256.png", 256],
  ["skitza-512.png", 512],
  ["skitza-maskable-512.png", 512],
] as const;

function readPngDimensionsAt(file: URL): {
  width: number;
  height: number;
} {
  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

describe("native app manifest", () => {
  it("enters through the public recovery route when no producer parent fallback exists", () => {
    const value = manifest();
    const producerLoading = new URL("../(producer)/loading.tsx", import.meta.url);
    const launchPage = readFileSync(
      new URL("../launch/page.tsx", import.meta.url),
      "utf8",
    );

    // The producer route-group fallback used to replace the persistent
    // AppShell during every soft navigation. Once that fallback is absent,
    // an installed cold/offline reopen must enter through the separately
    // cached, no-data launch document rather than a protected dashboard URL.
    expect(existsSync(producerLoading)).toBe(false);
    expect(value.start_url).toBe("/launch");
    expect(launchPage).toMatch(/dynamic\s*=\s*["']force-static["']/);
    expect(launchPage).toMatch(/<RuntimeResumeBoundary\s+navigate\s*\/>/);
  });

  it("describes one standalone app with regular and maskable install icons", () => {
    const value = manifest();

    expect(value).toMatchObject({
      id: "/",
      name: "Skitza",
      short_name: "Skitza",
      start_url: "/launch",
      scope: "/",
      display: "standalone",
      background_color: "#F2EDE6",
      theme_color: "#F2EDE6",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          src: "/icons/skitza-192.png",
          sizes: "192x192",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/skitza-512.png",
          sizes: "512x512",
          purpose: "any",
        }),
        expect.objectContaining({
          src: "/icons/skitza-maskable-192.png",
          sizes: "192x192",
          purpose: "maskable",
        }),
        expect.objectContaining({
          src: "/icons/skitza-maskable-512.png",
          sizes: "512x512",
          purpose: "maskable",
        }),
      ]),
    );
  });

  it("ships correctly sized static PNGs for iPhone and desktop installs", () => {
    for (const [fileName, expectedSize] of ICON_DIMENSIONS) {
      expect(
        readPngDimensionsAt(
          new URL(`../../../public/icons/${fileName}`, import.meta.url),
        ),
      ).toEqual({ width: expectedSize, height: expectedSize });
    }

    expect(readPngDimensionsAt(new URL("../icon.png", import.meta.url))).toEqual(
      { width: 32, height: 32 },
    );
    expect(
      readPngDimensionsAt(new URL("../apple-icon.png", import.meta.url)),
    ).toEqual({ width: 180, height: 180 });
  });

  it("exports the Apple standalone and light/dark browser metadata fragment", () => {
    expect(nativeAppMetadata).toMatchObject({
      manifest: "/manifest.webmanifest",
      appleWebApp: {
        capable: true,
        title: "Skitza",
        statusBarStyle: "black-translucent",
      },
      formatDetection: {
        telephone: false,
      },
      icons: {
        apple: [
          {
            url: "/icons/apple-touch-icon-180.png",
            sizes: "180x180",
          },
        ],
      },
    });
    expect(nativeAppViewport).toEqual({
      colorScheme: "light dark",
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
    });
  });
});
