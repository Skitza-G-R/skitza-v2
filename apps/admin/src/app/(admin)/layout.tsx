import type { ReactNode } from "react";

import { InactivityLock } from "~/components/inactivity-lock";
import { requireActiveAdminPage } from "~/server/auth/page-access";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireActiveAdminPage();
  return (
    <>
      <InactivityLock />
      {children}
    </>
  );
}
