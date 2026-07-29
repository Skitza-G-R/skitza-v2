import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

import { AdminContextStatus } from "./admin-context-status";
import { AdminMobileMenu } from "./admin-mobile-menu";
import { AdminNavigation } from "./admin-navigation";
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
      <a className="admin-skip-link" href="#admin-content">
        Skip to dashboard content
      </a>
      <div className="environment-ribbon" data-environment={environment.id} role="status">
        <span className="environment-ribbon-dot" aria-hidden="true" />
        {environment.id === "live" ? "Live" : "Test"} environment
        <span aria-hidden="true">·</span>
        <span>
          simulations on <span className="environment-ribbon-actions">· external actions off</span>
        </span>
      </div>

      <div className="admin-shell-grid">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-brand">
            <span className="admin-brand-mark" aria-hidden="true">
              S
            </span>
            <div className="wordmark">
              Skitza<span>.</span>
              <small>Admin</small>
            </div>
          </div>

          <div className="admin-sidebar-environment">
            <p className="admin-sidebar-label">Workspace</p>
            <EnvironmentSwitcher environment={environment.id} />
          </div>

          <AdminNavigation environment={environment.id} />

          <div className="admin-sidebar-footer">
            <AdminContextStatus environment={environment.id} />
            <div className="admin-account">
              <UserButton />
              <div>
                <strong>Founder access</strong>
                <span>Private workspace</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="admin-workspace">
          <header className="admin-mobile-header">
            <div className="admin-mobile-brand">
              <span className="admin-brand-mark" aria-hidden="true">
                S
              </span>
              <div className="wordmark">
                Skitza<span>.</span>
                <small>Admin</small>
              </div>
            </div>
            <AdminMobileMenu>
              <summary aria-label="Open admin navigation">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </summary>
              <div className="admin-mobile-menu-panel">
                <p className="admin-sidebar-label">Workspace</p>
                <EnvironmentSwitcher environment={environment.id} />
                <AdminNavigation environment={environment.id} mobile />
                <div className="admin-mobile-account">
                  <UserButton />
                  <span>Founder access</span>
                </div>
              </div>
            </AdminMobileMenu>
          </header>

          <main className="admin-main" id="admin-content">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
