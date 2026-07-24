import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (...segments: string[]) => readFileSync(join(here, ...segments), "utf8");

const artistApp = (...segments: string[]) =>
  join(here, "..", "..", "..", "app", "(artist)", "artist", ...segments);

describe("signed-in artist native route contract", () => {
  it("keeps every artist route family inside the persistent app shell", () => {
    const shell = src("..", "artist-app-shell.tsx");
    expect(shell).toContain("<ArtistRouteStatus />");
    expect(shell.match(/<PersistentPlayer \/>/g)).toHaveLength(1);
    expect(shell).toMatch(/<main\s+id="main-content"/);

    const routePages = [
      ["page.tsx"],
      ["music", "page.tsx"],
      ["music", "[projectId]", "page.tsx"],
      ["music", "song", "[versionId]", "page.tsx"],
      ["store", "page.tsx"],
      ["store", "[productId]", "page.tsx"],
      ["book", "page.tsx"],
      ["sessions", "page.tsx"],
      ["sessions", "[sessionId]", "page.tsx"],
      ["payments", "page.tsx"],
      ["payments", "[purchaseId]", "page.tsx"],
      ["payments", "[purchaseId]", "proof", "page.tsx"],
      ["offers", "[offerId]", "page.tsx"],
      ["settings", "page.tsx"],
    ];

    for (const route of routePages) {
      expect(existsSync(artistApp(...route)), route.join("/")).toBe(true);
    }
  });

  it("gates every owned live mutation surface on connectivity with truthful retry copy", () => {
    const liveSurfaces = [
      src("..", "..", "..", "app", "(artist)", "artist", "book", "booking-client.tsx"),
      src("..", "disconnect-producer-button.tsx"),
      src("..", "offers", "private-offer-response.tsx"),
      src("..", "purchase", "product-detail-screen.tsx"),
      src("..", "purchase", "review-agree-screen.tsx"),
      src("..", "purchase", "upload-proof-screen.tsx"),
      src("..", "purchase", "choose-plan-screen.tsx"),
      src("..", "purchase", "payment-instructions-screen.tsx"),
      src("..", "sessions", "session-detail-screen.tsx"),
      src("..", "sessions", "reschedule-confirm-sheet.tsx"),
    ];

    for (const surface of liveSurfaces) {
      expect(surface).toContain("useOnlineStatus");
      expect(surface).toMatch(/Reconnect/);
    }
    expect(liveSurfaces.join("\n")).toMatch(/No (session|purchase|proof|studio access)/);
  });

  it("keeps route failures local and preserves a safe way home", () => {
    const errorBoundary = src("..", "..", "..", "app", "(artist)", "artist", "error.tsx");
    const notFound = src("..", "..", "..", "app", "(artist)", "artist", "not-found.tsx");

    expect(errorBoundary).toContain("No booking or payment action was");
    expect(errorBoundary).toContain("<NativeAction");
    expect(errorBoundary).toContain('href="/artist"');
    expect(notFound).toContain('href="/artist"');
    expect(notFound).toContain("no longer belong to this artist account");
  });

  it("disables decorative loading motion when reduced motion is requested", () => {
    const loadingFiles = [
      ["loading.tsx"],
      ["store", "loading.tsx"],
      ["book", "loading.tsx"],
      ["sessions", "loading.tsx"],
      ["sessions", "[sessionId]", "loading.tsx"],
      ["purchase", "[productId]", "loading.tsx"],
      ["purchase", "[productId]", "agree", "loading.tsx"],
      ["purchase", "[productId]", "sent", "loading.tsx"],
      ["purchase", "[productId]", "pay", "loading.tsx"],
      ["purchase", "[productId]", "pay", "instructions", "loading.tsx"],
      ["purchase", "[productId]", "pay", "proof", "loading.tsx"],
    ];

    for (const loadingFile of loadingFiles) {
      const source = readFileSync(artistApp(...loadingFile), "utf8");
      expect(source, loadingFile.join("/")).toMatch(/animate-pulse\s+motion-reduce:animate-none/);
    }
  });

  it("only confirms the welcome connection after the durable server action succeeds", () => {
    const welcome = src(
      "..",
      "..",
      "..",
      "app",
      "(artist-welcome)",
      "artist-welcome",
      "[slug]",
      "page.tsx",
    );
    const signOut = src(
      "..",
      "..",
      "..",
      "app",
      "(artist-welcome)",
      "artist-welcome",
      "sign-out-link.tsx",
    );

    expect(welcome).toContain("connectionConfirmed = true");
    expect(welcome).toContain("{connectionConfirmed ? (");
    expect(welcome).toMatch(/No\s+studio access was added/);
    expect(welcome).toContain("Try connecting again");
    expect(signOut).toContain('role="alert"');
  });

  it("keeps signed-in artist navigation and account controls at 44px", () => {
    const desktop = src("..", "..", "nav", "artist-desktop-sidebar.tsx");
    const mobile = src("..", "..", "nav", "artist-mobile-top-bar.tsx");
    const settings = readFileSync(artistApp("settings", "page.tsx"), "utf8");

    expect(desktop).toContain("minHeight: 44");
    expect(desktop).toContain('avatarBox: "h-11 w-11');
    expect(mobile).toContain('avatarBox: "h-11 w-11');
    expect(settings).toContain('avatarBox: "h-11 w-11');
  });
});
