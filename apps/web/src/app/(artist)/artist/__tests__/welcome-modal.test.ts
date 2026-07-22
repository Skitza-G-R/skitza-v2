import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "../welcome-modal.tsx"), "utf8");

describe("artist welcome modal navigation copy", () => {
  it("describes the current five-tab artist navigation", () => {
    expect(source).toContain("Five tabs");
    for (const tab of ["Home", "Music", "Book", "Store", "Payments"]) {
      expect(source).toMatch(new RegExp(`<dt[^>]*>${tab}</dt>`));
    }
    expect(source).not.toContain("Four tabs");
  });

  it("uses a 44px large-radius dismissal target", () => {
    expect(source).toContain("min-h-11");
    expect(source).toContain("rounded-[var(--radius-lg)]");
  });

  it("uses the shared Radix dialog for focus trap, Escape, and focus return", () => {
    expect(source).toContain('from "~/components/ui/dialog"');
    expect(source).toMatch(/<Dialog\s+open=\{open\}/);
    expect(source).toContain("<DialogContent");
    expect(source).toContain("<DialogTitle");
    expect(source).toContain('className="pr-12 text-xl"');
    expect(source).not.toContain('role="dialog"');
  });
});
