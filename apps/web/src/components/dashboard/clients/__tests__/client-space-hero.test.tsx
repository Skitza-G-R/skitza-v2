import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-space-hero.tsx"), "utf-8");

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

  it("imports producerInitials + producerGradient for the 112px avatar tile", () => {
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

  it("uses the avatar size 112px (h-28 w-28)", () => {
    expect(SRC).toMatch(/h-28\b.*w-28|w-28\b.*h-28/);
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

  it("declares ClientSpaceHeroData with id + name + email + phone + linkState + joinedAt + nextProjectHref + stats", () => {
    expect(SRC).toContain("ClientSpaceHeroData");
    expect(SRC).toContain("name");
    expect(SRC).toContain("email");
    expect(SRC).toContain("linkState");
    expect(SRC).toContain("lifetime");
    expect(SRC).toContain("outstanding");
    expect(SRC).toContain("activeProjects");
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
    expect(SRC).toMatch(/<button[\s\S]{0,900}New project/);
    expect(SRC).not.toMatch(/<Link[\s\S]{0,200}newProjectHref/);
  });

  it("disables the '+ New project' pill when the client has no email", () => {
    // Producer can't create a project for a client without an email
    // address (project.create requires artistEmail). Better to block
    // the entry point than show a confusing 'Invalid input' toast.
    expect(SRC).toMatch(/disabled=\{!email\}/);
    expect(SRC).toMatch(/Add an email to this client/);
  });

  it("manages NewProjectModal open state via local useState (setNewProjectOpen)", () => {
    expect(SRC).toContain("setNewProjectOpen");
    expect(SRC).toContain("newProjectOpen");
  });

  it("mounts <NewProjectModal> with lockedClient set to the current client", () => {
    expect(SRC).toMatch(/<NewProjectModal/);
    expect(SRC).toMatch(/lockedClient=\{/);
  });

  it("accepts a products prop the hero forwards to NewProjectModal", () => {
    expect(SRC).toMatch(/products:\s*/);
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

  it("G4: h1 is 54px Syne with the design's negative tracking", () => {
    expect(SRC).toMatch(/font-syne[\s\S]*?text-\[54px\][\s\S]*?tracking-\[-0\.035em\]/);
  });

  it("G5: includes HeroGlowOrbs decorative element", () => {
    expect(SRC).toContain("HeroGlowOrbs");
    expect(SRC).toContain("~/components/dashboard/common/hero-glow-orbs");
  });

  it("G23: avatar uses literal 24px radius (not --radius-md)", () => {
    expect(SRC).toMatch(/rounded-\[24px\]/);
  });

  it("G14: '+ New project' CTA is solid white (not frosted glass)", () => {
    // Design uses btn-light (white solid pill, dark text) for the
    // hero's primary action. PR #130 introduced a sibling kebab menu
    // that DOES use the frosted bg-white/10 backdrop-blur treatment,
    // so we anchor on the New Project button's unique title attribute
    // to slice out JUST that button and assert against it.
    const titleAnchor = SRC.indexOf("Add an email to this client");
    expect(titleAnchor).toBeGreaterThan(0);
    const buttonStart = SRC.lastIndexOf("<button", titleAnchor);
    expect(buttonStart).toBeGreaterThan(-1);
    const labelIdx = SRC.indexOf("New project", titleAnchor);
    expect(labelIdx).toBeGreaterThan(buttonStart);
    const buttonSlice = SRC.slice(buttonStart, labelIdx);
    expect(buttonSlice).toMatch(/bg-white\s+px/);
    expect(buttonSlice).not.toMatch(/bg-white\/10/);
  });
});

describe("ClientSpaceHero — kebab menu wiring (Edit / Remove) — PR #130", () => {
  it("imports EditClientModal + RemoveClientConfirmModal", () => {
    expect(SRC).toContain("EditClientModal");
    expect(SRC).toContain("./edit-client-modal");
    expect(SRC).toContain("RemoveClientConfirmModal");
    expect(SRC).toContain("./remove-client-confirm-modal");
  });

  it("imports MoreVertical / Pencil / Trash2 lucide icons", () => {
    expect(SRC).toMatch(/MoreVertical/);
    expect(SRC).toMatch(/Pencil/);
    expect(SRC).toMatch(/Trash2/);
  });

  it("renders a kebab trigger with aria-label='Client actions'", () => {
    expect(SRC).toMatch(/aria-label="Client actions"/);
    expect(SRC).toMatch(/aria-haspopup="menu"/);
  });

  it("renders 'Edit details' + 'Remove client' menu items", () => {
    expect(SRC).toContain("Edit details");
    expect(SRC).toContain("Remove client");
  });

  it("closes the kebab menu on outside-click + Escape", () => {
    // Hand-rolled accessibility — the menu uses a single useEffect that
    // attaches a mousedown listener (for outside-click) and a keydown
    // listener (for Escape). Both fire only while the menu is open.
    expect(SRC).toMatch(/addEventListener\(\s*["']mousedown["']/);
    expect(SRC).toMatch(/Escape/);
  });

  it("uses notes on ClientSpaceHeroData (so the Edit modal can prefill)", () => {
    // The interface gained a `notes: string | null` field — without it
    // the modal would have no way to prefill the textarea on open.
    expect(SRC).toMatch(/notes:\s*string\s*\|\s*null/);
  });

  it("mounts <EditClientModal> with the current client's phone + notes", () => {
    expect(SRC).toMatch(/<EditClientModal[\s\S]*?phone[\s\S]*?notes/);
  });

  it("mounts <RemoveClientConfirmModal> with id + name", () => {
    expect(SRC).toMatch(/<RemoveClientConfirmModal/);
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
