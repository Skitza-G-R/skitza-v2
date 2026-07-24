import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const modalSource = readFileSync(join(__dirname, "../cancel-session-modal.tsx"), "utf8");

describe("producer cancel session modal wiring", () => {
  it("calls the real cancellation action with pending, error, and returned-use feedback", () => {
    expect(modalSource).toMatch(/import \{ cancelSession \} from "\.\/calendar-actions"/);
    expect(modalSource).toMatch(/await cancelSession\(\{/);
    expect(modalSource).toMatch(/isPending/);
    expect(modalSource).toMatch(/toast\(result\.error, "error"\)/);
    expect(modalSource).toMatch(/session use was returned/);
    expect(modalSource).not.toMatch(/coming soon/i);
  });

  it("keeps cancellation live-only and handles transport failures locally", () => {
    expect(modalSource).toContain("useOnlineStatus");
    expect(modalSource).toContain("Reconnect to cancel this session.");
    expect(modalSource).toContain("Could not cancel this session. Please try again.");
  });
});
