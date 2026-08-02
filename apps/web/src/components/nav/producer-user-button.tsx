"use client";

import { UserButton } from "@clerk/nextjs";

import {
  renderAccountRoleMenuItems,
  useAccountRoleMenuModel,
} from "./account-role-menu-items";

export function ProducerUserButton({
  userId,
  hasArtistAccount,
  artistUnreadCount,
  avatarClassName,
}: {
  userId: string;
  hasArtistAccount: boolean;
  artistUnreadCount: number;
  avatarClassName: string;
}) {
  const menuModel = useAccountRoleMenuModel({
    currentRole: "producer",
    userId,
    producerStatus: "complete",
    hasArtistAccount,
    otherRoleUnreadCount: artistUnreadCount,
    settingsHref: "/dashboard/settings",
  });

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: avatarClassName,
        },
      }}
    >
      {renderAccountRoleMenuItems(menuModel)}
    </UserButton>
  );
}
