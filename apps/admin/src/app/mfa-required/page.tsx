import { UserProfile } from "@clerk/nextjs";

import { AccessCard } from "~/components/access-card";
import { requireFounderRolePage } from "~/server/auth/page-access";

export default async function MfaRequiredPage() {
  await requireFounderRolePage();

  return (
    <AccessCard
      eyebrow="MFA required"
      showAccount
      title="Protect founder access."
    >
      <p className="access-copy">
        Add an authenticator or another second factor to your normal Skitza
        account. Admin access stays blocked until MFA is enabled.
      </p>
      <div className="mfa-profile">
        <UserProfile routing="hash" />
      </div>
      <a
        className="primary-button"
        href="/unlock"
        style={{ marginTop: "1.5rem", width: "100%" }}
      >
        Continue after enabling MFA
      </a>
    </AccessCard>
  );
}
