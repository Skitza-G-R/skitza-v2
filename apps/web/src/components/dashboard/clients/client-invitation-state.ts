export type ProducerClientInvitationState =
  | "available"
  | "requested"
  | "failed"
  | "provider_accepted"
  | "connected";

export type LinkPillState = "none" | "sending" | "failed" | "pending" | "active";

/** Maps the server-owned invitation truth into the standing Clients UI states. */
export function clientInvitationLinkState(state: ProducerClientInvitationState): LinkPillState {
  if (state === "connected") return "active";
  if (state === "provider_accepted") return "pending";
  if (state === "requested") return "sending";
  if (state === "failed") return "failed";
  return "none";
}

export function canOpenClientInvitation(state: LinkPillState): boolean {
  return state === "none" || state === "sending" || state === "failed" || state === "pending";
}
