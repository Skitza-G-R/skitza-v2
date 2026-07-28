import { notFound } from "next/navigation";

import { AdminShell } from "~/components/admin-shell";
import { EnvironmentChoice } from "~/components/environment-choice";
import {
  AdminEnvironmentConfigurationError,
  resolveAdminEnvironment,
} from "~/server/environment";
import { requireActiveAdminPage } from "~/server/auth/page-access";

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ environment?: string | string[] }>;
}) {
  await requireActiveAdminPage();
  const { environment } = await searchParams;
  if (environment === undefined) {
    return <EnvironmentChoice />;
  }
  if (Array.isArray(environment)) notFound();

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
      <section className="shell-heading">
        <div>
          <p className="eyebrow">Phase 1 · secure foundation</p>
          <h1 className="shell-title">Founder command center.</h1>
          <p className="shell-subtitle">
            The private shell is ready. Operational data and controls arrive
            only in their approved later phases.
          </p>
        </div>
        <span
          className="context-badge"
          data-environment={resolved.publicContext.id}
        >
          <span className="status-dot" aria-hidden="true" />
          {resolved.publicContext.label} context
        </span>
      </section>

      <section className="foundation-grid" aria-label="Admin foundation status">
        <article className="foundation-card foundation-card-dark">
          <p className="eyebrow" style={{ color: "rgb(var(--fg-inverse) / 0.6)" }}>
            Inactivity policy
          </p>
          <p className="foundation-number">
            30<span>m</span>
          </p>
          <p className="foundation-caption">
            The browser and every protected server request enforce the same
            session lock. Secure re-entry requires a fresh Cloudflare Access
            MFA login.
          </p>
        </article>

        <article className="foundation-card">
          <p className="eyebrow">Verified boundaries</p>
          <ul className="check-list">
            <li className="check-item">
              <span className="check-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <p className="check-title">Founder permission</p>
                <p className="check-copy">
                  Checked from server-only Clerk metadata.
                </p>
              </div>
            </li>
            <li className="check-item">
              <span className="check-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <p className="check-title">Independent MFA gateway</p>
                <p className="check-copy">
                  Cloudflare Access proof is validated before Clerk and again
                  at every protected server boundary.
                </p>
              </div>
            </li>
            <li className="check-item">
              <span className="check-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <p className="check-title">Environment isolation</p>
                <p className="check-copy">
                  Live and Test resolve through separate server bindings.
                </p>
              </div>
            </li>
          </ul>
        </article>
      </section>
    </AdminShell>
  );
}
