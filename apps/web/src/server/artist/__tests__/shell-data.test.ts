import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "shell-data.ts"), "utf8");

describe("artist shell notification state", () => {
  it("uses durable notification read state instead of activity proxies", () => {
    expect(source).toContain("artistNotificationUnreadCount");
    expect(source).not.toContain("caller.artist.home");
    expect(source).not.toContain("myPendingPayments");
    expect(source).not.toContain("RECENT_MIX_WINDOW");
  });

  it("keeps shell chrome available when notification storage cannot be read", () => {
    expect(source).toMatch(/try \{[\s\S]*artistNotificationUnreadCount[\s\S]*\} catch \{/);
    expect(source).toContain("return DEFAULT_STATE");
  });
});
