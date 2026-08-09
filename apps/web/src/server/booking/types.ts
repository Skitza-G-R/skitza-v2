export type SessionUseOutcome =
  | "reserved"
  | "completed"
  | "cancelled_on_time"
  | "cancelled_by_producer"
  | "cancelled_late"
  | "no_show";

export type SessionBookingBillingTreatment = "included" | "complimentary" | "billable_extra";

export type SessionBookingScheduleEntry = Readonly<{
  id: string;
  startsAt: Date;
  durationMin: number;
  bufferMinutes: number;
}>;

export type SessionBusyInterval = Readonly<{
  startsAt: Date;
  endsAt: Date;
}>;

export type SessionAvailabilityBlock = Readonly<{
  weekday: number;
  startMin: number;
  endMin: number;
}>;

export type SessionAvailabilityBlackout = Readonly<{
  startDate: string;
  endDate: string;
}>;
