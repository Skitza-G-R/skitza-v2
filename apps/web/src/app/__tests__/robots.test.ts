import { describe, expect, it } from "vitest";

import robots from "../robots";

describe("robots", () => {
  it("blocks private-by-URL song pages and every audio API", () => {
    const rules = robots().rules;
    const allRules = Array.isArray(rules) ? rules : [rules];
    const disallowed = allRules.flatMap((rule) => rule.disallow ?? []);

    expect(disallowed).toContain("/listen/");
    expect(disallowed).toContain("/api/");
    expect(disallowed).toContain("/changelog");
    expect(disallowed).toContain("/get-started");
  });
});
