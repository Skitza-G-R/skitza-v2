import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

import { AdminContextStatus } from "./admin-context-status";
import { EnvironmentSwitcher } from "./environment-switcher";
import type { AdminEnvironmentPublicContext } from "~/server/environment";

export function AdminShell({
  children,
  environment,
}: {
  children: ReactNode;
  environment: AdminEnvironmentPublicContext;
}) {
  return (
    <div className="admin-frame" data-admin-environment={environment.id}>
      <div
        className="environment-ribbon"
        data-environment={environment.id}
        role="status"
      >
        {environment.id === "live"
          ? "Live environment — real data and actions"
          : "Test environment — isolated test data and actions"}
      </div>
      <header className="admin-header">
        <div className="admin-header-inner">
          <div className="wordmark">
            Skitza.
            <span>Admin</span>
          </div>
          <div className="header-actions">
            <EnvironmentSwitcher environment={environment.id} />
            <UserButton />
          </div>
        </div>
      </header>
      <main className="admin-main">
        {children}
        <AdminContextStatus environment={environment.id} />
      </main>
    </div>
  );
}
