"use client";

import { UserButton } from "@clerk/nextjs";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBrowserRuntimeStorage,
  readRuntimeLaunchTargetForRole,
  type RuntimeRole,
} from "~/lib/runtime-state/runtime-state";
import { roleSwitchHref } from "~/server/auth/post-sign-in";
import type { ProducerProfileStatus } from "~/server/auth/role";

import { Icon } from "./icons";
import { canLeaveForRoleAction } from "./role-navigation-guard";

function OtherRoleIcon({ unread }: { unread: boolean }) {
  if (unread) {
    return (
      <span
        aria-label="Unread notifications in this role"
        className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--brand-primary))]"
      />
    );
  }
  return <Icon name="users" size={16} />;
}

function CurrentRoleStatusIcon({ role }: { role: RuntimeRole }) {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const menuItem = markerRef.current?.closest("button");
    if (!(menuItem instanceof HTMLButtonElement)) return;

    const priorTabIndex = menuItem.getAttribute("tabindex");
    const priorDisabled = menuItem.disabled;
    menuItem.dataset.roleCurrentStatus = "true";
    menuItem.setAttribute("aria-disabled", "true");
    menuItem.disabled = true;
    menuItem.tabIndex = -1;

    return () => {
      delete menuItem.dataset.roleCurrentStatus;
      menuItem.removeAttribute("aria-disabled");
      menuItem.disabled = priorDisabled;
      if (priorTabIndex === null) menuItem.removeAttribute("tabindex");
      else menuItem.setAttribute("tabindex", priorTabIndex);
    };
  }, []);

  return (
    <span ref={markerRef} aria-hidden>
      <Icon name={role === "artist" ? "music" : "home"} size={12} />
    </span>
  );
}

const keepCurrentRoleMenuOpen = () => undefined;

function defaultRoleHref(role: RuntimeRole): string {
  return role === "artist" ? "/artist" : "/dashboard";
}

type AccountRoleMenuInput = {
  currentRole: RuntimeRole;
  userId: string;
  producerStatus: ProducerProfileStatus;
  hasArtistAccount: boolean;
  otherRoleUnreadCount: number;
  settingsHref: string;
};

export type AccountRoleMenuModel = Readonly<{
  currentRole: RuntimeRole;
  currentLabel: string;
  settingsHref: string;
  roleAction: Readonly<{
    label: string;
    href: string;
    unread: boolean;
    onSelect: () => void;
  }> | null;
}>;

export function useAccountRoleMenuModel({
  currentRole,
  userId,
  producerStatus,
  hasArtistAccount,
  otherRoleUnreadCount,
  settingsHref,
}: AccountRoleMenuInput): AccountRoleMenuModel {
  const otherRole: RuntimeRole = currentRole === "artist" ? "producer" : "artist";
  const [switchHref, setSwitchHref] = useState(() =>
    roleSwitchHref(otherRole, defaultRoleHref(otherRole)),
  );

  useEffect(() => {
    const storage = getBrowserRuntimeStorage();
    const target = storage
      ? readRuntimeLaunchTargetForRole(storage, userId, otherRole)
      : null;
    setSwitchHref(roleSwitchHref(otherRole, target?.href ?? defaultRoleHref(otherRole)));
  }, [otherRole, userId]);

  const currentLabel = currentRole === "artist" ? "Artist · Current role" : "Producer · Current role";
  const roleAction =
    currentRole === "producer"
      ? hasArtistAccount
        ? {
            label: "Switch to Artist",
            href: switchHref,
            unread: otherRoleUnreadCount > 0,
          }
        : null
      : producerStatus === "complete"
        ? {
            label: "Switch to Producer",
            href: switchHref,
            unread: otherRoleUnreadCount > 0,
          }
        : producerStatus === "incomplete"
          ? {
              label: "Finish studio setup",
              href: "/onboarding",
              unread: false,
            }
          : {
              label: "Create a studio",
              href: "/onboarding/studio?intent=create-studio",
            unread: false,
          };

  const roleActionHref = roleAction?.href ?? null;
  const onRoleActionSelect = useCallback(() => {
    if (!roleActionHref) return;
    const canLeave = canLeaveForRoleAction({
      root: document,
      confirmDiscard: () =>
        window.confirm(
          "You have unsaved changes. Leave this workspace and discard them?",
        ),
    });
    if (canLeave) window.location.assign(roleActionHref);
  }, [roleActionHref]);

  return {
    currentRole,
    currentLabel,
    settingsHref,
    roleAction: roleAction
      ? { ...roleAction, onSelect: onRoleActionSelect }
      : null,
  };
}

/**
 * Call this as a renderer, not as a React component. Clerk inspects the type
 * of UserButton's direct child before rendering nested components, so callers
 * must pass this returned MenuItems element directly into UserButton.
 */
export function renderAccountRoleMenuItems(
  model: AccountRoleMenuModel,
  options?: { includeSettings?: boolean },
): ReactElement {
  const includeSettings = options?.includeSettings ?? true;
  return (
    <UserButton.MenuItems>
      <UserButton.Action
        label={model.currentLabel}
        labelIcon={<CurrentRoleStatusIcon role={model.currentRole} />}
        onClick={keepCurrentRoleMenuOpen}
      />
      {includeSettings ? (
        <UserButton.Link
          label="Settings"
          labelIcon={<Icon name="settings" size={16} />}
          href={model.settingsHref}
        />
      ) : null}
      {model.roleAction ? (
        <UserButton.Action
          label={model.roleAction.label}
          labelIcon={<OtherRoleIcon unread={model.roleAction.unread} />}
          onClick={model.roleAction.onSelect}
        />
      ) : null}
    </UserButton.MenuItems>
  );
}
