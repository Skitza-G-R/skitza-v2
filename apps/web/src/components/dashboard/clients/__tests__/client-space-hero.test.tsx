import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-space-hero.tsx"), "utf-8");
const ACTIONS_SRC = readFileSync(join(here, "..", "client-actions-menu.tsx"), "utf-8");

describe("ClientSpaceHero source — dark gradient hero, avatar, LinkPill, stats", () => {
  it("exports a ClientSpaceHero component (function)", () => {
    expect(SRC).toMatch(/export function ClientSpaceHero/);
  });

  it("imports deriveGradient and heroBg for the dark gradient band", () => {
    expect(SRC).toContain("deriveGradient");
    expect(SRC).toContain("heroBg");
    expect(SRC).toContain("~/lib/clients/derive-gradient");
    expect(SRC).toContain("~/lib/clients/hero-bg");
  });

  it("imports producerInitials + producerGradient for the avatar tile", () => {
    expect(SRC).toContain("producerInitials");
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("uses LinkPill inline with the client name", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("./link-pill");
  });

  it("uses StatTile from common for the 4-tile stats row", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
  });

  it("renders the eyebrow 'CLIENT' uppercase", () => {
    expect(SRC).toContain("CLIENT");
  });

  it("renders all four stat labels: Lifetime / Outstanding / Active projects / Joined", () => {
    expect(SRC).toContain("Lifetime");
    expect(SRC).toContain("Outstanding");
    expect(SRC).toContain("Active projects");
    expect(SRC).toContain("Joined");
  });

  it("uses a compact 96px desktop avatar (md:h-24 md:w-24)", () => {
    expect(SRC).toMatch(/md:h-24\b.*md:w-24|md:w-24\b.*md:h-24/);
  });

  it("renders the '+ New project' CTA on the right side", () => {
    expect(SRC).toMatch(/New project/);
  });

  it("places the dark hero background via inline style with heroBg(token)", () => {
    expect(SRC).toMatch(/style=\{\{[^}]*background:[^}]*heroBg/);
  });

  it("accepts an onInvite callback that fires when LinkPill state is none", () => {
    expect(SRC).toContain("onInvite");
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("declares ClientSpaceHeroData with editable fields, archive state, link state, and stats", () => {
    expect(SRC).toContain("ClientSpaceHeroData");
    expect(SRC).toContain("name");
    expect(SRC).toContain("email");
    expect(SRC).toContain("linkState");
    expect(SRC).toContain("lifetime");
    expect(SRC).toContain("outstanding");
    expect(SRC).toContain("activeProjects");
    expect(SRC).toMatch(/tags:\s*string\[\]/);
    expect(SRC).toMatch(/archived:\s*boolean/);
  });

  it("represents purchase commercial totals as nullable and labels them unavailable", () => {
    expect(SRC).toMatch(/lifetime:\s*number\s*\|\s*null/);
    expect(SRC).toMatch(/outstanding:\s*number\s*\|\s*null/);
    expect(SRC).toContain("Unavailable");
  });

  // ── Phase 1 G7 — NewProjectModal wiring ─────────────────────────
  // The "+ New project" pill used to be a <Link> to the legacy /new
  // page. It now opens NewProjectModal in lockedClient mode so the
  // producer can't accidentally repoint the project to a different
  // client.
  it("imports NewProjectModal from the clients folder (G7)", () => {
    expect(SRC).toContain("NewProjectModal");
    expect(SRC).toContain("./new-project-modal");
  });

  it("renders the '+ New project' pill as a <button> (not a <Link>)", () => {
    // Range widened to {0,900} to accommodate the disabled-state
    // styling + title prop added in the email-null guard.
    // Range widened to {0,1400} for the SK-60 mobile classes + comment.
    expect(SRC).toMatch(/<button[\s\S]{0,1400}New project/);
    expect(SRC).not.toMatch(/<Link[\s\S]{0,200}newProjectHref/);
  });

  it("turns the primary action into Add email when the client has no email", () => {
    // Project creation still requires an artist email, but the producer
    // now gets a useful next action instead of a disabled button.
    expect(SRC).toMatch(/else if\s*\(!email\)\s*\{\s*setEditOpen\(true\)/);
    expect(SRC).toContain('!email ? "Add email" : "New project"');
  });

  it("manages NewProjectModal open state via local useState (setNewProjectOpen)", () => {
    expect(SRC).toContain("setNewProjectOpen");
    expect(SRC).toContain("newProjectOpen");
  });

  it("mounts <NewProjectModal> with lockedClient set to the current client", () => {
    expect(SRC).toMatch(/<NewProjectModal/);
    expect(SRC).toMatch(/lockedClient=\{/);
  });

  it("does not pass commercial product terms into NewProjectModal", () => {
    expect(SRC).not.toMatch(/products:\s*NewProjectModalProductOption/);
    expect(SRC).not.toMatch(/products=\{products\}/);
  });
});

describe("ClientSpaceHero PR-A polish — G4+G5+G14+G23 design alignment", () => {
  it("G4: hero is full-bleed (negative horizontal margins, no border-radius on the band)", () => {
    // Design HTML 252: hero band is full-width, no rounded corners.
    // Negative margins cancel the page padding so the band reaches the
    // content-area edges. The assertion targets the <section> wrapper
    // specifically so inner CTAs are free to use the standard rectangle
    // radius (`--radius-lg`) per docs/design/buttons.md.
    expect(SRC).toMatch(/-mx-4[\s\S]*?sm:-mx-6|sm:-mx-6[\s\S]*?-mx-4/);
    const sectionMatch = SRC.match(/<section[\s\S]*?className="([^"]+)"/);
    expect(sectionMatch).not.toBeNull();
    const sectionCls = sectionMatch?.[1] ?? "";
    expect(sectionCls).toMatch(/-mx-4/);
    expect(sectionCls).not.toMatch(/\brounded-/);
  });

  it("G4: h1 is compact Syne with the design's negative tracking", () => {
    // 26px 2-line clamp <md; a tighter 44px one-liner at md+.
    expect(SRC).toMatch(/font-syne[\s\S]*?tracking-\[-0\.035em\][\s\S]*?md:text-\[44px\]/);
    expect(SRC).toMatch(/line-clamp-2[\s\S]*?text-\[26px\]/);
  });

  it("G5: includes HeroGlowOrbs decorative element", () => {
    expect(SRC).toContain("HeroGlowOrbs");
    expect(SRC).toContain("~/components/dashboard/common/hero-glow-orbs");
  });

  it("G23: avatar uses a tighter literal desktop radius (not --radius-md)", () => {
    expect(SRC).toMatch(/md:rounded-\[22px\]/);
  });

  it("G14: '+ New project' CTA is solid white (not frosted glass)", () => {
    // The same solid button adapts to Restore, Add email, or New project.
    const decisionAnchor = SRC.indexOf("if (archived)");
    expect(decisionAnchor).toBeGreaterThan(0);
    const buttonStart = SRC.lastIndexOf("<button", decisionAnchor);
    expect(buttonStart).toBeGreaterThan(-1);
    const buttonEnd = SRC.indexOf("</button>", decisionAnchor);
    expect(buttonEnd).toBeGreaterThan(buttonStart);
    const buttonSlice = SRC.slice(buttonStart, buttonEnd);
    expect(buttonSlice).toMatch(/bg-white\s+px/);
    expect(buttonSlice).not.toMatch(/bg-white\/10/);
  });
});

describe("ClientSpaceHero — visible client management actions", () => {
  it("imports edit, archive, and permanent-delete dialogs", () => {
    expect(SRC).toContain("EditClientModal");
    expect(SRC).toContain("./edit-client-modal");
    expect(SRC).toContain("RemoveClientConfirmModal");
    expect(SRC).toContain("./remove-client-confirm-modal");
    expect(SRC).toContain("ClientArchiveConfirmModal");
    expect(SRC).toContain("./client-archive-confirm-modal");
  });

  it("imports the icons for the three contextual primary states", () => {
    expect(SRC).toMatch(/\bPlus\b/);
    expect(SRC).toMatch(/Pencil/);
    expect(SRC).toMatch(/ArchiveRestore/);
  });

  it("uses the shared accessible action disclosure", () => {
    expect(SRC).toContain("<ClientActionsMenu");
    expect(ACTIONS_SRC).toMatch(/aria-expanded=\{open\}/);
    expect(ACTIONS_SRC).toMatch(/aria-controls=\{disclosureId\}/);
    expect(ACTIONS_SRC).toMatch(/aria-label=\{label\s*\?\?/);
  });

  it("renders Edit and Archive or Restore as visible text actions", () => {
    expect(SRC).toContain("Edit");
    expect(SRC).toContain("Archive");
    expect(SRC).toContain("Restore");
    expect(SRC).toMatch(/setEditOpen\(true\)/);
    expect(SRC).toMatch(/setArchiveOpen\(true\)/);
  });

  it("focuses the desktop disclosure and closes it on pointerdown + Escape", () => {
    expect(ACTIONS_SRC).toMatch(/firstActionRef\.current\?\.focus\(\)/);
    expect(ACTIONS_SRC).toMatch(/addEventListener\(\s*["']pointerdown["']/);
    expect(ACTIONS_SRC).toMatch(/event\.key\s*!==\s*["']Escape["']/);
    expect(ACTIONS_SRC).toMatch(/triggerRef\.current\?\.focus\(\)/);
    expect(ACTIONS_SRC).not.toContain("onBlurCapture");
  });

  it("uses notes on ClientSpaceHeroData (so the Edit modal can prefill)", () => {
    // The interface gained a `notes: string | null` field — without it
    // the modal would have no way to prefill the textarea on open.
    expect(SRC).toMatch(/notes:\s*string\s*\|\s*null/);
  });

  it("mounts <EditClientModal> with the current client's phone + notes", () => {
    expect(SRC).toMatch(/<EditClientModal[\s\S]*?phone[\s\S]*?notes[\s\S]*?tags/);
  });

  it("turns the archived client's primary action into Restore client", () => {
    expect(SRC).toMatch(/if\s*\(archived\)\s*\{\s*setArchiveOpen\(true\)/);
    expect(SRC).toContain('archived ? "Restore client"');
  });

  it("mounts permanent delete only when the shared domain rule says the draft is empty", () => {
    expect(SRC).toMatch(/canPermanentlyDelete\s*\?\s*\([\s\S]{0,300}<RemoveClientConfirmModal/);
    expect(SRC).toMatch(/onDelete=\{[\s\S]{0,100}canPermanentlyDelete/);
  });
});

describe("ClientSpaceHero — inline link-state meta (Resend / Active in artist app)", () => {
  // HTML mockup hero meta row includes the link state as inline text
  // ("Invitation sent · Resend invite link" / "Active in artist app").
  // The LinkPill next to the h1 is the at-a-glance signal; this line
  // adds the verb so the producer can one-click resend a pending invite
  // without re-opening the modal.

  it("imports sendClientInviteAction for the resend handler", () => {
    expect(SRC).toContain("sendClientInviteAction");
  });

  it("imports useTransition for the resend pending state", () => {
    expect(SRC).toMatch(/useTransition/);
  });

  it("renders the 'Resend invite link' affordance for pending state", () => {
    expect(SRC).toMatch(/linkState\s*===\s*["']pending["']/);
    expect(SRC).toContain("Resend invite link");
    expect(SRC).toContain("Invitation sent");
  });

  it("renders the 'Active in artist app' affirmation for active state", () => {
    expect(SRC).toMatch(/linkState\s*===\s*["']active["']/);
    expect(SRC).toContain("Active in artist app");
  });

  it("wires the resend handler through sendClientInviteAction({ via: 'email' })", () => {
    expect(SRC).toMatch(/sendClientInviteAction\([\s\S]*?via:\s*["']email["']/);
  });

  it("uses useToast for resend success / error feedback", () => {
    expect(SRC).toContain("useToast");
  });
});
