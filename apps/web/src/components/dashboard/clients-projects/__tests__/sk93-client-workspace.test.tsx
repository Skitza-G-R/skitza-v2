import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "workspace-list-view.tsx"), "utf8");

describe("SK-93 client workspace", () => {
  it("makes Find client obvious and searches stable client fields", () => {
    expect(source).toMatch(/type=["']search["']/);
    expect(source).toContain("Find client");
    expect(source).toMatch(/clientSearch|searchQuery|deferredClientSearch/);
  });

  it("uses clear Active and Archived client filters", () => {
    expect(source).toMatch(/value:\s*["']active["'],\s*label:\s*["']Active["']/);
    expect(source).toMatch(/value:\s*["']archived["'],\s*label:\s*["']Archived["']/);
    expect(source).toMatch(/c\.archived/);
  });

  it("wires visible edit and archive/restore row actions in every client layout", () => {
    expect(source).toMatch(/onEdit=/g);
    expect(source).toMatch(/onArchive=/g);
    expect(source).toContain("EditClientModal");
    expect(source).toContain("ClientArchiveConfirmModal");
    expect(source).toMatch(/blockedReason=\{archiveTarget\.archiveBlockedReason/);
  });

  it("has explicit no-client, no-archived-client, and no-search-result states", () => {
    expect(source).toContain("No active clients yet");
    expect(source).toContain("No archived clients");
    expect(source).toContain("No clients match");
  });

  it("never offers archived clients when creating a project", () => {
    expect(source).toMatch(/clients[\s\S]*?filter\(\(c\)\s*=>\s*!c\.archived/);
  });
});
