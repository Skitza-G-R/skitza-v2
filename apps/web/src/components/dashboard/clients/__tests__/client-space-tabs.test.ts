import { describe, expect, it } from "vitest";

import { resolveClientSpaceInitialTab } from "../client-space-tabs";

describe("resolveClientSpaceInitialTab", () => {
  it("opens Payments only for the locked exact deep link", () => {
    expect(resolveClientSpaceInitialTab("payments")).toBe("payments");
  });

  it.each([undefined, "", "projects", "details", ["payments"], ["payments", "details"]])(
    "defaults %j to Projects",
    (value) => {
      expect(resolveClientSpaceInitialTab(value)).toBe("projects");
    },
  );
});
