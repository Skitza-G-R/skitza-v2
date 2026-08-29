import type { ReactNode } from "react";

import { AdminShell } from "~/components/admin-shell";
import { InactivityLock } from "~/components/inactivity-lock";
import { DashboardInteractionProvider } from "~/features/dashboard/dashboard-interactions";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import { getAdminEnvironmentPublicContext } from "~/server/environment";

export const dynamic = "force-dynamic";

// SK-288 — one layout for the whole console. There is no environment
// segment to resolve any more, so the shell that used to live under
// `[environment]/layout.tsx` merged up into this one.
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  await requireActiveAdminPage();

  return (
    <>
      <InactivityLock />
      <AdminShell environment={getAdminEnvironmentPublicContext()}>
        <DashboardInteractionProvider>{children}</DashboardInteractionProvider>
      </AdminShell>
    </>
  );
}
