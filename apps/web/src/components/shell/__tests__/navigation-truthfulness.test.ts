import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, "..", name), "utf8");
const appShell = read("app-shell.tsx");
const cheatsheet = read("shortcut-cheatsheet.tsx");
const bridge = read("shortcuts-bridge.tsx");

describe("producer shell navigation truthfulness", () => {
  it("removes the outdated automatic coachmark tour", () => {
    expect(appShell).not.toContain("CoachmarkTour");
    expect(appShell).not.toContain("coachmark-tour");
  });

  it("does not advertise keyboard shortcuts without working handlers", () => {
    expect(cheatsheet).not.toContain('{ k: "/", desc: "Search" }');
    expect(cheatsheet).not.toContain('title: "Context shortcuts"');
    for (const phantom of [
      "Upload track (Project Room)",
      "Toggle done (Project Room)",
      "Edit (context-aware)",
    ]) {
      expect(cheatsheet).not.toContain(phantom);
    }
    expect(cheatsheet).not.toContain('k: "c"');
    expect(cheatsheet).not.toContain("Create (context-aware)");
  });

  it("uses the shared Radix dialog for complete keyboard focus handling", () => {
    expect(cheatsheet).toContain('from "~/components/ui/dialog"');
    expect(cheatsheet).toMatch(/<Dialog\s+open=\{open\}/);
    expect(cheatsheet).toContain("<DialogContent");
    expect(cheatsheet).toContain("pr-12 text-xl");
    expect(cheatsheet).not.toContain("window.addEventListener");
  });

  it("does not advertise or handle the retired manual New project shortcut", () => {
    expect(cheatsheet).not.toContain("New project");
    expect(cheatsheet).not.toContain('{ k: "n"');
    expect(bridge).not.toContain("createNewProject");
    expect(bridge).not.toContain("newProject=1");
  });
});
