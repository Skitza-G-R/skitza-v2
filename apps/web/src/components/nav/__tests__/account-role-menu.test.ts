import { readFileSync } from "node:fs";

import { UserButton } from "@clerk/nextjs";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it } from "vitest";

import {
  renderAccountRoleMenuItems,
  type AccountRoleMenuModel,
} from "../account-role-menu-items";
import {
  canLeaveForRoleAction,
  hasUnsavedRoleChanges,
} from "../role-navigation-guard";

const source = readFileSync(new URL("../account-role-menu-items.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);
const dirtySurfaceSources = [
  "../../../app/(producer)/dashboard/settings/settings-client.tsx",
  "../../../components/artist/settings/artist-settings-client.tsx",
  "../../../app/(producer)/dashboard/booking/availability-editor.tsx",
  "../../../app/(producer)/dashboard/calendar/availability-panel.tsx",
  "../../../components/dashboard/setup/marketing-section.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("SK-161 account role menu", () => {
  it("shows the current role and the approved switch copy", () => {
    expect(source).toContain("Artist · Current role");
    expect(source).toContain("Producer · Current role");
    expect(source).toContain("Switch to Artist");
    expect(source).toContain("Switch to Producer");
    expect(source).toContain('menuItem.dataset.roleCurrentStatus = "true"');
    expect(source).toContain('menuItem.setAttribute("aria-disabled", "true")');
    expect(source).toContain("menuItem.disabled = true");
    expect(globalCss).toContain('[data-role-current-status="true"]');
  });

  it("offers explicit Producer setup actions from Artist mode", () => {
    expect(source).toContain("Create a studio");
    expect(source).toContain("Finish studio setup");
    expect(source).toContain("intent=create-studio");
  });

  it("renders the other-role unread indicator only inside the role action", () => {
    expect(source).toContain("otherRoleUnreadCount > 0");
    expect(source).toContain("<OtherRoleIcon unread={model.roleAction.unread}");
    expect(source).toContain("rounded-full bg-[rgb(var(--brand-primary))]");
  });

  it("returns Clerk's MenuItems element with direct Clerk menu-item children", () => {
    const model: AccountRoleMenuModel = {
      currentRole: "artist",
      currentLabel: "Artist · Current role",
      settingsHref: "/artist/settings",
      roleAction: {
        label: "Switch to Producer",
        href: "/auth/switch?role=producer",
        unread: true,
        onSelect: () => undefined,
      },
    };
    const menu = renderAccountRoleMenuItems(model);
    const children = Children.toArray(
      (menu as ReactElement<{ children: ReactNode }>).props.children,
    ).filter(isValidElement);

    expect(menu.type).toBe(UserButton.MenuItems);
    expect(children.map((child) => child.type)).toEqual([
      UserButton.Action,
      UserButton.Link,
      UserButton.Action,
    ]);
    const statusItem = children[0] as ReactElement<{
      label: string;
      onClick: () => void;
    }>;
    expect(statusItem.props.label).toBe("Artist · Current role");
    expect(typeof statusItem.props.onClick).toBe("function");
    const mobileMenu = renderAccountRoleMenuItems(model, {
      includeSettings: false,
    });
    const mobileChildren = Children.toArray(
      (mobileMenu as ReactElement<{ children: ReactNode }>).props.children,
    ).filter(isValidElement);
    expect(mobileChildren.map((child) => child.type)).toEqual([
      UserButton.Action,
      UserButton.Action,
    ]);
    expect(
      mobileChildren.some(
        (child) =>
          (child as ReactElement<{ label?: string }>).props.label === "Settings",
      ),
    ).toBe(false);
  });
});

describe("role-action unsaved changes guard", () => {
  const root = (dirty: boolean) => ({
    querySelector: () => (dirty ? {} : null),
  });

  it("navigates immediately when the current screen is clean", () => {
    const confirmDiscard = () => false;
    expect(hasUnsavedRoleChanges(root(false))).toBe(false);
    expect(
      canLeaveForRoleAction({ root: root(false), confirmDiscard }),
    ).toBe(true);
  });

  it("blocks a dirty screen until the user explicitly confirms", () => {
    expect(hasUnsavedRoleChanges(root(true))).toBe(true);
    expect(
      canLeaveForRoleAction({
        root: root(true),
        confirmDiscard: () => false,
      }),
    ).toBe(false);
    expect(
      canLeaveForRoleAction({
        root: root(true),
        confirmDiscard: () => true,
      }),
    ).toBe(true);
  });

  it("marks every explicit Artist and Producer dirty-state surface", () => {
    for (const dirtySurface of dirtySurfaceSources) {
      expect(dirtySurface).toContain("data-role-switch-unsaved=");
    }
  });
});
