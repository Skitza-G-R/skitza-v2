import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { nextTabIndex } from "~/lib/keyboard/tab-navigation";

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = readFileSync(join(here, "..", "client-space-workspace.tsx"), "utf8");

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex, `Missing source start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Missing source end marker: ${end}`).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("ClientSpaceWorkspace tabs", () => {
  it("starts from the server-locked tab and keeps later tab changes local", () => {
    expect(WORKSPACE).toMatch(/initialTab = "projects"/);
    expect(WORKSPACE).toMatch(
      /const \[activeTab, setActiveTab\] = useState<ClientSpaceTab>\(initialTab\)/,
    );
    expect(WORKSPACE).not.toMatch(
      /useRouter|usePathname|useSearchParams|URLSearchParams|window\.history|router\.(?:push|replace)|localStorage|sessionStorage/,
    );
  });

  it("defines exactly Projects, Payments, and Details in that order", () => {
    const declaration = WORKSPACE.match(/const CLIENT_SPACE_TABS:[^=]+=\s*\[([^\]]+)\]/);
    const tabs = declaration?.[1]?.match(/"(?:projects|payments|details)"/g) ?? [];

    expect(tabs).toEqual(['"projects"', '"payments"', '"details"']);
    expect(WORKSPACE).toMatch(
      /const TAB_LABEL:[\s\S]*?projects:\s*"Projects"[\s\S]*?payments:\s*"Payments"[\s\S]*?details:\s*"Details"/,
    );
  });

  it("uses a complete ARIA tab contract and the shared wrapping keyboard helper", () => {
    const tabMarkup = sourceBetween(WORKSPACE, 'role="tablist"', "data-tab-swipe-surface");

    expect(tabMarkup).toContain('aria-label="Client sections"');
    expect(tabMarkup).toMatch(/role="tab"/);
    expect(tabMarkup).toMatch(/aria-selected=\{selected\}/);
    expect(tabMarkup).toMatch(/aria-controls=\{`client-space-panel-\$\{tab\}`\}/);
    expect(tabMarkup).toMatch(/tabIndex=\{selected \? 0 : -1\}/);
    expect(tabMarkup).toMatch(/nextTabIndex\(index, CLIENT_SPACE_TABS\.length, event\.key\)/);
    expect(tabMarkup).toMatch(/event\.preventDefault\(\)/);
    expect(tabMarkup).toMatch(
      /document\.getElementById\(`client-space-tab-\$\{next\}`\)\?\.focus\(\)/,
    );

    expect(nextTabIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextTabIndex(1, 3, "Home")).toBe(0);
    expect(nextTabIndex(1, 3, "End")).toBe(2);
    expect(nextTabIndex(1, 3, "Enter")).toBeNull();
  });

  it("keeps the sticky tab bar outside the direct SK-142 swipe surface and panel", () => {
    const stickyIndex = WORKSPACE.indexOf('className="sticky top-0');
    const tabListIndex = WORKSPACE.indexOf('role="tablist"', stickyIndex);
    const swipeSurfaceIndex = WORKSPACE.indexOf("data-tab-swipe-surface");
    const swipePanelIndex = WORKSPACE.indexOf("data-tab-swipe-panel", swipeSurfaceIndex);

    expect(stickyIndex).toBeGreaterThanOrEqual(0);
    expect(WORKSPACE).toContain("top-0");
    expect(WORKSPACE).toContain("lg:top-16");
    expect(WORKSPACE).not.toContain("top-[calc(4rem+env(safe-area-inset-top,0px))]");
    expect(tabListIndex).toBeGreaterThan(stickyIndex);
    expect(swipeSurfaceIndex).toBeGreaterThan(tabListIndex);
    expect(swipePanelIndex).toBeGreaterThan(swipeSurfaceIndex);

    const stickyTabs = WORKSPACE.slice(stickyIndex, swipeSurfaceIndex);
    expect(stickyTabs).not.toContain("data-tab-swipe-surface");
    expect(stickyTabs).not.toContain("data-tab-swipe-panel");

    const swipePanel = sourceBetween(WORKSPACE, "data-tab-swipe-panel", "<InviteToAppModal");
    expect(swipePanel).toMatch(/role="tabpanel"/);
    expect(swipePanel).toMatch(/aria-labelledby=\{`client-space-tab-\$\{activeTab\}`\}/);
  });

  it("changes tabs locally without navigation or refetch work in tab handlers", () => {
    const tabHandlers = sourceBetween(WORKSPACE, 'role="tablist"', "data-tab-swipe-surface");

    expect(tabHandlers).toMatch(/onClick=\{\(\) => \{\s*setActiveTab\(tab\)/);
    expect(tabHandlers).toMatch(/setActiveTab\(next\)/);
    expect(tabHandlers).not.toMatch(
      /loadClientPrivateOffersAction|fetch\(|refetch|invalidate|refresh\(|router\.|window\.location/,
    );
  });
});

describe("ClientSpaceWorkspace compact content contracts", () => {
  it("uses a compact header and shows one conditional payment alert that switches locally", () => {
    const header = sourceBetween(
      WORKSPACE,
      "function CompactClientHeader",
      "function ProjectsPanel",
    );
    const attentionBranches = header.match(/attentionCopy\s*\?/g) ?? [];

    expect(header).toMatch(/h-14 w-14/);
    expect(header).toMatch(/truncate text-\[24px\]/);
    expect(header).toContain("<LinkPill");
    expect(attentionBranches).toHaveLength(1);
    expect(header).toMatch(
      /attentionCopy \? \([\s\S]*?<button[\s\S]*?onClick=\{onPayments\}[\s\S]*?<AlertCircle/,
    );
    expect(WORKSPACE).toMatch(/onPayments=\{\(\) => \{\s*setActiveTab\("payments"\)/);
    expect(WORKSPACE).toMatch(/\.\.\.\(canInvite[\s\S]*?onInvite:/);
    expect(WORKSPACE).toContain("canOpenClientInvitation(client.linkState)");
    expect(header).toMatch(
      /<LinkPill[\s\S]*?state=\{client\.linkState\}[\s\S]*?\{\.\.\.\(onInvite \? \{ onInvite \} : \{\}\)\}/,
    );
    expect(header).toMatch(/client\.linkState === "none" && !onInvite[\s\S]*?Not connected/);
    expect(WORKSPACE).toContain("Invitation sending");
    expect(WORKSPACE).toContain("Invitation failed");
    expect(WORKSPACE).toMatch(/if \(due\.length === 0 && needsReviewCount === 0\) return null/);
    expect(WORKSPACE).not.toMatch(/StatTile|HeroGlowOrbs|heroBg\(/);
  });

  it("wires Payments to the distinct compact client payment presentation", () => {
    const payments = sourceBetween(WORKSPACE, "function PaymentsPanel", "function DetailsPanel");

    expect(payments).toContain("<ClientPaymentsPanel state={payments} clientName={clientName} />");
    expect(payments).not.toContain("ProducerPaymentWorkspace");
  });

  it("renders compact read-only Details with one Edit action and every locked section", () => {
    const details = sourceBetween(WORKSPACE, "function DetailsPanel", "function DetailCard");
    const editLabels = details.match(/>\s*Edit\s*</g) ?? [];

    expect(editLabels).toHaveLength(1);
    for (const section of [
      "Contact information",
      "Connection status",
      "Private notes",
      "Tags",
      "Private offers",
    ]) {
      expect(details).toContain(`title="${section}"`);
    }
    expect(details).toMatch(/client\.email \?\? "Not added"/);
    expect(details).toMatch(/client\.phone \?\? "Not added"/);
    expect(details).toMatch(/client\.notes\?\.trim\(\) \|\| "No private notes yet\."/);
    expect(details).toMatch(/client\.tags\.map/);
    expect(details).toMatch(/connectionLabel\(client\.linkState\)/);
    expect(details).toMatch(/offers\.offers\.map/);
  });

  it("keeps manual New project and New offer actions out of Client Space", () => {
    const header = sourceBetween(
      WORKSPACE,
      "function CompactClientHeader",
      "function ProjectsPanel",
    );

    expect(header).not.toContain("Add for");
    expect(WORKSPACE).not.toContain("NewProjectModal");
    expect(WORKSPACE).not.toContain("PrivateOfferComposer");
    expect(WORKSPACE).not.toContain("client-add-sheet");
    expect(WORKSPACE).not.toContain('label="New Offer"');
    expect(WORKSPACE).not.toContain('label="New Project"');
    expect(WORKSPACE).toContain(
      "New work appears here after the artist starts through your Skitza link.",
    );
  });
});

describe("ClientSpaceWorkspace resend invitation evidence", () => {
  it("keeps one operation key for ordinary and in-flight retries", () => {
    expect(WORKSPACE).toMatch(/const resendAttemptRef = useRef<\{/);
    expect(WORKSPACE).toMatch(
      /operationKey = `client-invite:\$\{client\.id\}:\$\{crypto\.randomUUID\(\)\}`/,
    );
    expect(WORKSPACE).toMatch(/resendAttemptRef\.current = \{[\s\S]*?operationKey,/);
    expect(WORKSPACE).toMatch(
      /sendClientInviteAction\(\{\s*id: client\.id,\s*via: "email",\s*operationKey,\s*\}\)/,
    );
    expect(WORKSPACE).toMatch(
      /result\.data\.deliveryState !== "provider_accepted"[\s\S]*?invitation email is still sending/,
    );
    expect(WORKSPACE).toContain("Check send status");
  });

  it("rotates only after a conflict and only on the next deliberate resend", () => {
    expect(WORKSPACE).toMatch(
      /result\.code === "new_operation_required"[\s\S]*?rotateOnNextClick = true/,
    );
    expect(WORKSPACE).toContain("Try a new send");
    expect(WORKSPACE).toMatch(/currentAttempt\.rotateOnNextClick[\s\S]*?crypto\.randomUUID\(\)/);
    expect(WORKSPACE).not.toMatch(/rotateOnNextClick = true[\s\S]{0,300}sendClientInviteAction/);
  });

  it("shows sent success only with provider acceptance evidence", () => {
    expect(WORKSPACE).toMatch(
      /result\.data\.deliveryState !== "provider_accepted"\s*\|\|\s*!result\.data\.providerAcceptedAtIso/,
    );
    expect(WORKSPACE).toMatch(
      /resendAttemptRef\.current = null;[\s\S]{0,120}toast\("Invitation email sent again", "success"\)/,
    );
  });
});
