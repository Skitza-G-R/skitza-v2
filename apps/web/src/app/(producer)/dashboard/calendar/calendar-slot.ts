export type ManualSessionSlot = {
  studioDate: string;
  studioStartMin: number;
};

export type ManualSessionDraft = ManualSessionSlot & {
  durationMin: number | null;
};

const QUARTER_HOUR_MIN = 15;
const QUARTERS_PER_HOUR = 60 / QUARTER_HOUR_MIN;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function studioDateKey(dayMarker: Date): string {
  return `${pad(dayMarker.getUTCFullYear(), 4)}-${pad(dayMarker.getUTCMonth() + 1)}-${pad(
    dayMarker.getUTCDate(),
  )}`;
}

export function calendarSlotFromPointer({
  dayMarker,
  hour,
  clientY,
  cellTop,
  cellHeight,
}: {
  dayMarker: Date;
  hour: number;
  clientY: number;
  cellTop: number;
  cellHeight: number;
}): ManualSessionSlot {
  if (cellHeight <= 0) {
    return { studioDate: studioDateKey(dayMarker), studioStartMin: hour * 60 };
  }

  const offset = Math.min(Math.max(clientY - cellTop, 0), cellHeight);
  const quarter = Math.min(
    QUARTERS_PER_HOUR - 1,
    Math.floor((offset / cellHeight) * QUARTERS_PER_HOUR),
  );

  return {
    studioDate: studioDateKey(dayMarker),
    studioStartMin: hour * 60 + quarter * QUARTER_HOUR_MIN,
  };
}
