import { AccessCard } from "~/components/access-card";
import { UnlockButton } from "~/components/unlock-button";
import { requireFounderEnrollmentPage } from "~/server/auth/page-access";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  await requireFounderEnrollmentPage();
  const { reason } = await searchParams;
  const inactive = reason === "inactive";

  return (
    <AccessCard
      eyebrow="Secure admin session"
      showAccount
      title={inactive ? "Session locked." : "Unlock admin."}
    >
      <p className="access-copy">
        {inactive
          ? "The admin locked after 30 minutes without activity. Verify your identity again to continue."
          : "Founder permission and MFA are required before any admin data or operation is available."}
      </p>
      <UnlockButton />
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
