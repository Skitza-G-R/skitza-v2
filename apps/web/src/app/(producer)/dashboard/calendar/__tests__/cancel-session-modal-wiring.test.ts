import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const managementSource = readFileSync(join(__dirname, "../session-management-sheet.tsx"), "utf8");

describe("producer session management cancellation wiring", () => {
  it("keeps cancellation inside the unified sheet and calls the real action", () => {
    expect(managementSource).toMatch(/cancelSession,/);
    expect(managementSource).toMatch(/await cancelSession\(\{/);
    expect(managementSource).toMatch(/reason: reasonLabel/);
    expect(managementSource).toMatch(/note: note\.trim\(\)/);
    expect(managementSource).toMatch(/isPending/);
    expect(managementSource).toMatch(/setError\(result\.error\)/);
    expect(managementSource).toMatch(/session use was returned/);
    expect(managementSource).not.toMatch(/coming soon/i);
  });

  it("keeps cancellation live-only and renders it as an inline Manage step", () => {
    expect(managementSource).toContain("useOnlineStatus");
    expect(managementSource).toContain("Reconnect to cancel this session.");
    expect(managementSource).toContain('type Step = SessionManagementStep | "reschedule_warnings"');
    expect(managementSource).toContain('goTo("cancel")');
    expect(managementSource).toContain('step === "cancel"');
    expect(managementSource).not.toMatch(/<CancelSessionModal/);
  });
});
