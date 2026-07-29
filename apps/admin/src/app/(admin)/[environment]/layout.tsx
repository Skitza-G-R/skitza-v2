import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { AdminShell } from "~/components/admin-shell";
import { DashboardInteractionProvider } from "~/features/dashboard/dashboard-interactions";
import { requireActiveAdminPage } from "~/server/auth/page-access";
import { AdminEnvironmentConfigurationError, resolveAdminEnvironment } from "~/server/environment";

export default async function AdminEnvironmentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ environment: string }>;
}) {
  await requireActiveAdminPage();
  const { environment } = await params;

  let resolved;
  try {
    resolved = resolveAdminEnvironment(process.env, environment);
  } catch (error) {
    if (
      error instanceof AdminEnvironmentConfigurationError &&
      error.code === "ADMIN_ENVIRONMENT_INVALID"
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <AdminShell environment={resolved.publicContext}>
      <DashboardInteractionProvider>{children}</DashboardInteractionProvider>
    </AdminShell>
  );
}
