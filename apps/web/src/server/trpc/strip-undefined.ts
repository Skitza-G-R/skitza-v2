// zod `.optional()` produces `string | undefined`, but with
// `exactOptionalPropertyTypes` Drizzle's insert/update types refuse
// the explicit `undefined`. Strip undefined keys so optional columns
// are simply omitted (and take their DB default / stay unchanged).
// The mapped return type drops `undefined` from each value union so
// the result is assignable to drizzle's strict insert/update shape.
//
// Lives in its own module so every router that builds drizzle
// payloads from zod-parsed input can share it.
export type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export const stripUndefined = <T extends Record<string, unknown>>(obj: T): Defined<T> => {
  const out = {} as Defined<T>;
  for (const k in obj) {
    if (obj[k] !== undefined) out[k] = obj[k] as Defined<T>[typeof k];
  }
  return out;
};
