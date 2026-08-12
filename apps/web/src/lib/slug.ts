import { createHash } from "node:crypto";

export function emailToSlug(email: string): string {
  const [local = ""] = email.toLowerCase().split("@");
  const beforePlus = local.split("+")[0] ?? "";
  const cleaned = beforePlus
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\./g, "-")
    .replace(/^-|-$/g, "") || "user";
  const hash = createHash("sha256").update(email).digest("hex").slice(0, 4);
  return `${cleaned}-${hash}`;
}

/**
 * Private placeholder used only between an accepted Producer invitation and
 * completion of Studio onboarding. The invitation id adds enough entropy that
 * another Producer cannot cheaply reserve the invitee's predictable slug and
 * permanently block provisioning. Onboarding replaces this placeholder before
 * the Producer publishes a join link.
 */
export function invitationPlaceholderSlug(
  email: string,
  invitationId: string,
): string {
  const body = emailToSlug(email).replace(/-[0-9a-f]{4}$/, "").slice(0, 34);
  const hash = createHash("sha256")
    .update(`${email.trim().toLowerCase()}:${invitationId}`)
    .digest("hex")
    .slice(0, 12);
  return `${body || "studio"}-${hash}`;
}

export const isAutoSlug = (slug: string, email: string): boolean => slug === emailToSlug(email);
