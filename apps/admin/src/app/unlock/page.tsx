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
      {/* Vendor-neutral wording: the outer wall is Cloudflare Access or Vercel
          Deployment Protection depending on ADMIN_ACCESS_MODE (SK-274), so
          naming one of them here is wrong half the time. */}
      <p className="access-copy">
        {inactive
          ? "The admin locked after 30 minutes without activity. Unlocking needs a fresh sign-in token, so the first attempt starts re-entry and the next one completes it."
          : finishing
            ? "Re-entry has started. Wait a moment for a fresh sign-in token, then press unlock again to restore the founder session."
            : "A verified sign-in and founder permission are required before any admin data or operation is available."}
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
