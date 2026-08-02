"use client";

import { UserButton } from "@clerk/nextjs";
import type { ProducerProfileStatus } from "~/server/auth/role";

import {
  renderAccountRoleMenuItems,
  useAccountRoleMenuModel,
} from "./account-role-menu-items";

export function ArtistUserButton({
  userId,
  producerStatus,
  producerUnreadCount,
  settingsHref,
  ringClassName,
}: {
  userId: string;
  producerStatus: ProducerProfileStatus;
  producerUnreadCount: number;
  settingsHref: string;
  ringClassName: string;
}) {
  const menuModel = useAccountRoleMenuModel({
    currentRole: "artist",
    userId,
    producerStatus,
    hasArtistAccount: true,
    otherRoleUnreadCount: producerUnreadCount,
    settingsHref,
  });

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: `h-11 w-11 ring-1 ${ringClassName}`,
        },
      }}
    >
      {renderAccountRoleMenuItems(menuModel)}
    </UserButton>
  );
}
