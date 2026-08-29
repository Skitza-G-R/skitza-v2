import { notFound } from "next/navigation";

import { RegisteredUserProfile } from "~/features/registered-users/profile-view";
import { isValidRegisteredUserId } from "~/features/registered-users/view-model";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import {
  parseRegisteredUserProfileTab,
  RegisteredUserProfileAccessError,
} from "~/server/registered-users/service";
import { createRegisteredUserRuntime } from "~/server/registered-users/runtime";

export default async function AdminUserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{
    cursor?: string | readonly string[];
    tab?: string | readonly string[];
  }>;
}) {
  await requireActiveAdminPage();
  const { userId } = await params;
  if (!isValidRegisteredUserId(userId)) notFound();

  const search = await searchParams;
  const requestedTab = parseRegisteredUserProfileTab(search.tab);
  const cursorInput = search.cursor;
  const rawCursor =
    typeof cursorInput === "string" ? cursorInput.trim() : "";
  const malformedActivityCursor =
    (cursorInput !== undefined && typeof cursorInput !== "string") ||
    (rawCursor !== "" && !/^[A-Za-z0-9_-]{1,2000}$/.test(rawCursor));
  const activityCursor =
    rawCursor && /^[A-Za-z0-9_-]{1,2000}$/.test(rawCursor)
      ? rawCursor
      : null;
  const runtime = createRegisteredUserRuntime();
  const header = await runtime.repository.findProfileHeader(userId);
  if (!header) notFound();

  const tab = header.status === "Deleted" ? "summary" : requestedTab;
  try {
    const tabData = await runtime.repository.findProfileTab(userId, tab, {
      activityCursor,
      allowDeletedSummary: header.status === "Deleted",
    });
    const visibleTabData =
      malformedActivityCursor && tabData.tab === "activity"
        ? { ...tabData, cursorReset: true }
        : tabData;
    return (
      <RegisteredUserProfile
        activityCursor={activityCursor}
        header={header}
        providerDashboardUrl={runtime.providerDashboardUrl}
        requestedTab={requestedTab}
        tab={tab}
        tabData={visibleTabData}
        userId={userId}
      />
    );
  } catch (error) {
    if (error instanceof RegisteredUserProfileAccessError) notFound();
    throw error;
  }
}
