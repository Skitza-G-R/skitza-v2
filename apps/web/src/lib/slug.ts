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
