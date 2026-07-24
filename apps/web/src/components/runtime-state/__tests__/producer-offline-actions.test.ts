import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_SRC = join(__dirname, "../../..");

const mountedProducerActions = [
  "app/(producer)/dashboard/onboarding/onboarding-wizard.tsx",
  "app/(producer)/dashboard/portfolio/portfolio-panel.tsx",
  "app/(producer)/dashboard/settings/settings-client.tsx",
  "components/dashboard/clients/client-archive-confirm-modal.tsx",
  "components/dashboard/clients/client-space-hero.tsx",
  "components/dashboard/clients/edit-client-modal.tsx",
  "components/dashboard/clients/invite-modal.tsx",
  "components/dashboard/clients/new-client-modal.tsx",
  "components/dashboard/clients/new-project-modal.tsx",
  "components/dashboard/clients/remove-client-confirm-modal.tsx",
  "components/dashboard/offers/private-offer-composer.tsx",
  "components/dashboard/offers/private-offer-manager.tsx",
  "components/dashboard/overview/mobile-payment-row.tsx",
  "components/dashboard/overview/needs-you-payment-row.tsx",
  "components/dashboard/projects/delete-empty-project-dialog.tsx",
  "components/dashboard/projects/edit-project-dialog.tsx",
  "components/dashboard/projects/project-lifecycle-dialog.tsx",
  "components/dashboard/projects/project-purchases-panel.tsx",
  "components/dashboard/song/add-song-dialog.tsx",
  "components/dashboard/song/change-stage-menu.tsx",
  "components/music/song-management-controls.tsx",
  "components/music/song-public-link-controls.tsx",
] as const;

describe("mounted producer live actions", () => {
  it.each(mountedProducerActions)("%s has an explicit offline boundary", (relativePath) => {
    const source = readFileSync(join(WEB_SRC, relativePath), "utf8");
    expect(source).toContain("useOnlineStatus");
    expect(source).toMatch(/if \([^)]*!online[^)]*\)/);
    expect(source).toMatch(/Reconnect/);
  });

  it.each(mountedProducerActions)("%s handles transport rejection locally", (relativePath) => {
    const source = readFileSync(join(WEB_SRC, relativePath), "utf8");
    expect(source).toMatch(/catch\s*(?:\(|\{)/);
  });

  it("guards portfolio optimistic changes before mutating local rows", () => {
    const source = readFileSync(
      join(WEB_SRC, "app/(producer)/dashboard/portfolio/portfolio-panel.tsx"),
      "utf8",
    );
    expect(source.indexOf('toast("Reconnect to change your featured tracks.')).toBeLessThan(
      source.indexOf("setRows((all) => all.filter((r) => r.id !== id))"),
    );
    expect(source).toContain("finally {\n        setAdding(false);");
    expect(source).toContain("finally {\n        setPendingId(null);");
  });
});
