export type CalendarTabKey = "meetings" | "availability";

export function isCalendarTab(v: string | undefined): v is CalendarTabKey {
  return v === "meetings" || v === "availability";
}
