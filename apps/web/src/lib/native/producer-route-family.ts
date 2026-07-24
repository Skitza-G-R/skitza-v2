export type ProducerRouteFamily =
  | "today"
  | "calendar"
  | "workspace"
  | "music"
  | "payments"
  | "portfolio"
  | "requests"
  | "settings"
  | "store"
  | "onboarding";

const SAFE_ID = "[A-Za-z0-9_-]{1,128}";

const ROUTE_FAMILIES: ReadonlyArray<readonly [RegExp, ProducerRouteFamily]> = [
  [/^\/dashboard$/, "today"],
  [/^\/dashboard\/calendar$/, "calendar"],
  [/^\/dashboard\/clients-projects(?:\/new)?$/, "workspace"],
  [new RegExp(`^/dashboard/clients-projects/(?!new$|clients$)${SAFE_ID}$`), "workspace"],
  [new RegExp(`^/dashboard/clients-projects/${SAFE_ID}/songs/${SAFE_ID}$`), "workspace"],
  [new RegExp(`^/dashboard/clients-projects/clients/${SAFE_ID}$`), "workspace"],
  [/^\/dashboard\/music$/, "music"],
  [new RegExp(`^/dashboard/music/(?!project$)${SAFE_ID}$`), "music"],
  [new RegExp(`^/dashboard/music/project/${SAFE_ID}$`), "music"],
  [/^\/dashboard\/payments$/, "payments"],
  [new RegExp(`^/dashboard/payments/${SAFE_ID}$`), "payments"],
  [/^\/dashboard\/portfolio$/, "portfolio"],
  [/^\/dashboard\/profile$/, "settings"],
  [/^\/dashboard\/requests$/, "requests"],
  [new RegExp(`^/dashboard/requests/${SAFE_ID}$`), "requests"],
  [/^\/dashboard\/settings$/, "settings"],
  [/^\/dashboard\/store$/, "store"],
  [/^\/dashboard\/onboarding$/, "onboarding"],
];

export function producerRouteFamily(pathname: string): ProducerRouteFamily | null {
  for (const [pattern, family] of ROUTE_FAMILIES) {
    if (pattern.test(pathname)) return family;
  }
  return null;
}
