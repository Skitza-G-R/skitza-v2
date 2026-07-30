type ProducerVersionUploadAccess = Readonly<{
  projectLifecycleStatus: "waiting_for_payment" | "active" | "paused" | "completed" | "canceled";
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled";
  trackArchived: boolean;
  artistApprovalLocked: boolean;
}>;

export function producerProjectOriginHref(
  projectId: string,
  originProjectId: string | undefined,
): string | undefined {
  if (originProjectId !== projectId) return undefined;
  return `/dashboard/clients-projects/${encodeURIComponent(projectId)}`;
}

export function canUploadProducerSongVersion(input: ProducerVersionUploadAccess): boolean {
  return (
    input.projectLifecycleStatus === "active" &&
    input.purchaseLifecycleStatus === "active" &&
    !input.trackArchived &&
    !input.artistApprovalLocked
  );
}
