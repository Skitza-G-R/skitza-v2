import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

type CacheDecision = Readonly<{
  action: "cache" | "network-only";
  reason: string;
}>;

type RequestLike = Readonly<{
  url: string;
  method: string;
  mode: string;
  destination: string;
  headers: Headers;
}>;

type CachePolicy = Readonly<{
  classifyRequest: (request: RequestLike, ownOrigin: string) => CacheDecision;
}>;

const OWN_ORIGIN = "https://skitza.app";
let policy: CachePolicy;

function request(
  path: string,
  init: {
    method?: string;
    destination?: string;
    headers?: HeadersInit;
  } = {},
): RequestLike {
  return {
    url: new URL(path, OWN_ORIGIN).toString(),
    method: init.method ?? "GET",
    mode: "same-origin",
    destination: init.destination ?? "",
    headers: new Headers(init.headers),
  };
}

beforeAll(() => {
  const source = readFileSync(
    new URL("../../../../public/pwa/cache-policy.js", import.meta.url),
    "utf8",
  );
  const sandbox: Record<string, unknown> = { URL };
  runInNewContext(source, sandbox);
  policy = sandbox.SkitzaCachePolicy as CachePolicy;
});

describe("service worker cache policy", () => {
  it.each([
    "/_next/static/chunks/app-a1b2c3.js",
    "/_next/static/css/app-a1b2c3.css",
    "/icons/skitza-192.png",
    "/manifest.webmanifest",
    "/offline.html",
  ])("allows only the explicit static/public resource %s", (path) => {
    expect(policy.classifyRequest(request(path), OWN_ORIGIN)).toEqual({
      action: "cache",
      reason: "explicit-safe-resource",
    });
  });

  it.each([
    ["/dashboard", "sensitive-path"],
    ["/dashboard/clients", "sensitive-path"],
    ["/artist/payments/purchase-1", "sensitive-path"],
    ["/api/trpc/project.list", "sensitive-path"],
    ["/trpc/project.list", "sensitive-path"],
    ["/sign-in", "sensitive-path"],
    ["/listen/private-song-token", "sensitive-path"],
    ["/audio/locked-master.wav", "sensitive-path"],
    ["/media/unlocked/example.mp3", "not-allowlisted"],
    ["/public/store", "not-allowlisted"],
  ])("keeps %s network-only (%s)", (path, reason) => {
    expect(policy.classifyRequest(request(path), OWN_ORIGIN)).toEqual({
      action: "network-only",
      reason,
    });
  });

  it("rejects RSC payloads even when they target an otherwise safe path", () => {
    expect(
      policy.classifyRequest(request("/_next/static/chunks/app.js?_rsc=private"), OWN_ORIGIN),
    ).toEqual({ action: "network-only", reason: "rsc" });
    expect(
      policy.classifyRequest(
        request("/_next/static/chunks/app.js", {
          headers: { RSC: "1" },
        }),
        OWN_ORIGIN,
      ),
    ).toEqual({ action: "network-only", reason: "rsc" });
  });

  it("rejects signed URLs, authorization, range media, and Clerk origins", () => {
    expect(
      policy.classifyRequest(
        request("/icons/skitza-192.png?X-Amz-Signature=secret&X-Amz-Expires=60"),
        OWN_ORIGIN,
      ),
    ).toEqual({ action: "network-only", reason: "signed-url" });
    expect(
      policy.classifyRequest(
        request("/_next/static/chunks/app.js", {
          headers: { Authorization: "Bearer private" },
        }),
        OWN_ORIGIN,
      ),
    ).toEqual({ action: "network-only", reason: "authorization" });
    expect(
      policy.classifyRequest(
        request("/icons/skitza-192.png", {
          destination: "audio",
          headers: { Range: "bytes=0-1023" },
        }),
        OWN_ORIGIN,
      ),
    ).toEqual({ action: "network-only", reason: "range" });
    expect(
      policy.classifyRequest(
        {
          ...request("/v1/client", { method: "GET" }),
          url: "https://clerk.skitza.app/v1/client",
        },
        OWN_ORIGIN,
      ),
    ).toEqual({ action: "network-only", reason: "cross-origin" });
  });

  it("never caches writes", () => {
    expect(
      policy.classifyRequest(request("/icons/skitza-192.png", { method: "POST" }), OWN_ORIGIN),
    ).toEqual({ action: "network-only", reason: "non-get" });
  });
});
