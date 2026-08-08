export type ClientSpaceTab = "projects" | "payments" | "details";

/** Only the locked global-Payments deep link may override the Projects default. */
export function resolveClientSpaceInitialTab(tab: string | string[] | undefined): ClientSpaceTab {
  return tab === "payments" ? "payments" : "projects";
}
