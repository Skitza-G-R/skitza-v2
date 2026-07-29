import { AccessCard } from "~/components/access-card";
import { UnlockButton } from "~/components/unlock-button";
import { requireFounderRolePage } from "~/server/auth/page-access";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{
    complete?: string | string[];
    reason?: string | string[];
  }>;
}) {
  await requireFounderRolePage();
  const { complete, reason } = await searchParams;
  const inactive = reason === "inactive";
  const finishing = complete === "1";

  return (
    <AccessCard
      eyebrow="Secure admin session"
      showAccount
      title={
        inactive
          ? "Session locked."
          : finishing
            ? "Finish secure re-entry."
            : "Unlock admin."
      }
    >
      <p className="access-copy">
        {inactive
          ? "The admin locked after 30 minutes without activity. A new Cloudflare Access login with independent MFA is required."
          : finishing
            ? "Complete the server freshness check to restore the founder session."
            : "Cloudflare Access MFA and founder permission are required before any admin data or operation is available."}
      </p>
      <UnlockButton finishing={finishing} />
      <p
        style={{
          color: "rgb(var(--fg-muted))",
          fontSize: "0.72rem",
          lineHeight: 1.5,
          margin: "1rem 0 0",
          textAlign: "center",
        }}
      >
        The session locks again after 30 inactive minutes.
      </p>
    </AccessCard>
  );
}
