import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";

import { AdminContextStatus } from "./admin-context-status";
import { AdminMobileMenu } from "./admin-mobile-menu";
import { AdminNavigation } from "./admin-navigation";
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
        {/* The ribbon says which database this session is pointed at, and
            nothing more. It once added "simulations on · external actions
            off", which stopped being true when Beta and Users began sending
            real invitations — a founder trusting that line could release a
            wave to real people believing it was a dry run. SK-288 removed the
            last fixture screens, so every page here now shows real data and
            there is only one environment to be in. */}
        {environment.label} environment
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

          <AdminNavigation />

          <div className="admin-sidebar-footer">
            <AdminContextStatus />
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
                <AdminNavigation mobile />
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
