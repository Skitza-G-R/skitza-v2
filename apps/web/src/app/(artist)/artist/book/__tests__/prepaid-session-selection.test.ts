import { describe, expect, it } from "vitest";

import {
  findPrepaidSessionByAllowance,
  uniquePrepaidSessionForProject,
} from "../prepaid-session-selection";

const allowances = [
  {
    projectId: "project-1",
    purchaseId: "purchase-1",
    sessionAllowanceId: "allowance-1",
    durationMin: 60,
  },
  {
    projectId: "project-1",
    purchaseId: "purchase-2",
    sessionAllowanceId: "allowance-2",
    durationMin: 90,
  },
] as const;

describe("prepaid session selection", () => {
  it("selects the exact allowance when one project has multiple purchases", () => {
    expect(findPrepaidSessionByAllowance(allowances, "allowance-2")).toEqual(
      allowances[1],
    );
  });

  it("fails closed when a project-only deep link is ambiguous", () => {
    expect(uniquePrepaidSessionForProject(allowances, "project-1")).toBeNull();
  });

  it("allows a legacy project-only deep link only when it identifies one allowance", () => {
    expect(uniquePrepaidSessionForProject([allowances[0]], "project-1")).toEqual(
      allowances[0],
    );
  });
});
