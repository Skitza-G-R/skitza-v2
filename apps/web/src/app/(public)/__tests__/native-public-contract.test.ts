import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const WEB_ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), "utf8");
}

function filesBelow(relativeDirectory: string): string[] {
  const directory = join(WEB_ROOT, relativeDirectory);
  const filenames: string[] = [];

  function visit(currentDirectory: string) {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const filename = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(filename);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        filenames.push(filename);
      }
    }
  }

  visit(directory);
  return filenames.filter((filename) => !filename.includes("__tests__"));
}

type CacheDecision = Readonly<{ action: "cache" | "network-only"; reason: string }>;
type CachePolicy = Readonly<{
  classifyRequest(
    request: Readonly<{
      method: string;
      url: string;
      destination?: string;
      headers: { get(name: string): string | null };
    }>,
    ownOrigin: string,
  ): CacheDecision;
}>;

function cachePolicy(): CachePolicy {
  const sandbox: Record<string, unknown> = { URL };
  runInNewContext(source("public/pwa/cache-policy.js"), sandbox);
  return sandbox.SkitzaCachePolicy as CachePolicy;
}

function request(pathname: string) {
  return {
    method: "GET",
    url: `https://skitza.example${pathname}`,
    destination: "document",
    headers: { get: () => null },
  } as const;
}

describe("SK-115 anonymous route and privacy matrix", () => {
  it("keeps every real anonymous HTML family network-only", () => {
    const policy = cachePolicy();
    for (const pathname of [
      "/",
      "/about",
      "/privacy",
      "/terms",
      "/changelog",
      "/get-started",
      "/get-started/he",
      "/get-started/thanks",
      "/get-started/he/thanks",
      "/sign-in",
      "/sign-up",
      "/sign-up/join/studio-name",
      "/join/studio-name",
      "/listen/redacted",
    ]) {
      expect(policy.classifyRequest(request(pathname), "https://skitza.example").action).toBe(
        "network-only",
      );
    }
    expect(
      policy.classifyRequest(
        {
          ...request("/icons/skitza-192.png"),
          destination: "image",
        },
        "https://skitza.example",
      ),
    ).toEqual({ action: "cache", reason: "explicit-safe-resource" });
  });

  it("never mounts signed-in tabs or install guidance on anonymous pages", () => {
    const filenames = [
      ...filesBelow("src/app/(public)"),
      ...filesBelow("src/app/get-started"),
      ...filesBelow("src/components/landing"),
      ...filesBelow("src/components/join"),
      ...filesBelow("src/components/public-song"),
      ...filesBelow("src/components/auth"),
    ];
    const combined = filenames.map((filename) => readFileSync(filename, "utf8")).join("\n");

    expect(combined).not.toMatch(
      /NativeInstallGuidance|ProducerBottomNav|ArtistBottomNav|ProducerSidebar|ArtistAppShell|AppShell/,
    );
  });

  it("gives the global skip link a focusable target on every public composition", () => {
    for (const filename of [
      "src/components/landing/landing-page.tsx",
      "src/app/(public)/(legal)/layout.tsx",
      "src/app/(public)/(auth)/layout.tsx",
      "src/app/(public)/changelog/page.tsx",
      "src/app/(public)/join/[slug]/page.tsx",
      "src/components/public-song/public-song-player.tsx",
      "src/app/get-started/page.tsx",
      "src/app/get-started/he/page.tsx",
      "src/app/get-started/thanks/page.tsx",
      "src/app/get-started/he/thanks/page.tsx",
    ]) {
      const contents = source(filename);
      expect(contents, filename).toContain('id="main-content"');
      expect(contents, filename).toContain("tabIndex={-1}");
    }
  });

  it("keeps capability listening UI out of durable browser storage", () => {
    const combined = [
      source("src/components/join/join-bento.tsx"),
      source("src/components/join/join-mini-player.tsx"),
      source("src/components/public-song/public-song-player.tsx"),
      source("src/app/(guest-song)/listen/[token]/page.tsx"),
    ].join("\n");

    expect(combined).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|CacheStorage/);
    expect(source("src/app/(guest-song)/listen/[token]/page.tsx")).not.toMatch(
      /console\.(?:log|warn|error)/,
    );
  });

  it("uses the shared native press and connectivity feedback on public action surfaces", () => {
    for (const filename of [
      "src/components/landing/landing-page.tsx",
      "src/components/join/join-bento.tsx",
      "src/components/join/join-mini-player.tsx",
      "src/components/public-song/public-song-player.tsx",
      "src/app/(public)/(auth)/layout.tsx",
      "src/app/get-started/_components/waitlist-form.tsx",
    ]) {
      expect(source(filename), filename).toContain("sk-press");
    }
    expect(source("src/app/(public)/layout.tsx")).toContain("<PublicConnectivityNotice");
    expect(source("src/app/get-started/_components/waitlist-form.tsx")).toContain(
      "usePublicOnline",
    );
  });

  it("blocks new network listening offline while preserving pause and retry controls", () => {
    const joinBento = source("src/components/join/join-bento.tsx");
    const joinPlayer = source("src/components/join/join-mini-player.tsx");
    const publicSong = source("src/components/public-song/public-song-player.tsx");
    const waitlist = source("src/app/get-started/_components/waitlist-form.tsx");

    expect(joinBento).toContain("(!online && !isPlaying)");
    expect(joinBento).toContain("isActive && isPlaying");
    expect(joinBento).not.toContain("<animate");
    expect(joinPlayer).toContain("disabled={!state.playing && !online}");
    expect(publicSong).toContain("disabled={!online && !selectedIsPlaying}");
    expect(waitlist).toContain("if (!online)");
    expect(waitlist).toContain("Check your connection and try again.");
  });
});
