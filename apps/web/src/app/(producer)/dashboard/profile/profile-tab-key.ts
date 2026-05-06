export type ProfileTabKey = "store" | "portfolio";

export function isProfileTab(v: string | undefined): v is ProfileTabKey {
  return v === "store" || v === "portfolio";
}
