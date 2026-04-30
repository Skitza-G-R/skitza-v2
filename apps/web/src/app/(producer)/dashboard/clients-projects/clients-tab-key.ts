export type ClientsTabKey = "clients" | "projects";

export function isClientsTab(v: string | undefined): v is ClientsTabKey {
  return v === "clients" || v === "projects";
}
