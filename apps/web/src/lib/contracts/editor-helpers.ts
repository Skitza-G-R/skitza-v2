// Pure helpers for the contract editor. Lives outside the React tree
// so they're trivial to unit-test without a DOM. Anything that needs
// `document` or `window` belongs in the client components, not here.

export type FieldType =
  | "signature"
  | "initial"
  | "date"
  | "text"
  | "checkbox"
  | "dropdown"
  | "number";

export interface FieldLike {
  id?: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: FieldType;
  required: boolean;
  recipientId: string | null;
  prefilledValue: string | null;
  options: Record<string, unknown> | null;
}

// Default field rectangles per type — percent of page. Chosen to look
// plausible on a letter-sized PDF: signatures long and low, checkboxes
// square, dates short and narrow. These mirror the numbers documented
// in the B.6 plan so the editor UI matches the spec out of the box.
export const DEFAULT_FIELD_SIZE: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 30, h: 6 },
  initial: { w: 8, h: 6 },
  date: { w: 15, h: 4 },
  text: { w: 25, h: 4 },
  checkbox: { w: 4, h: 4 },
  dropdown: { w: 20, h: 4 },
  number: { w: 12, h: 4 },
};

// Labels shown in the palette + on placed field tiles.
export const FIELD_LABELS: Record<FieldType, string> = {
  signature: "Signature",
  initial: "Initials",
  date: "Date",
  text: "Text",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  number: "Number",
};

// Clamp a rect to the page. The router enforces the same invariant
// server-side with a 0.01 tolerance; we clamp to 100 exactly because
// the UI renders relative to page bounds and a 100.01 width would
// overflow visually.
export function clampRect(r: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { x: number; y: number; w: number; h: number } {
  const w = Math.max(0.5, Math.min(100, r.w));
  const h = Math.max(0.5, Math.min(100, r.h));
  const x = Math.max(0, Math.min(100 - w, r.x));
  const y = Math.max(0, Math.min(100 - h, r.y));
  return { x, y, w, h };
}

// Produce a fresh field at a given page/center, clamped to stay inside
// the page. centerX/Y are in percent; the rect is offset so its center
// lands there. Used by click-to-place in the palette.
export function createFieldAt(args: {
  type: FieldType;
  page: number;
  centerX: number;
  centerY: number;
  recipientId?: string | null;
}): FieldLike {
  const size = DEFAULT_FIELD_SIZE[args.type];
  const rect = clampRect({
    x: args.centerX - size.w / 2,
    y: args.centerY - size.h / 2,
    w: size.w,
    h: size.h,
  });
  return {
    page: args.page,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    type: args.type,
    required: true,
    recipientId: args.recipientId ?? null,
    prefilledValue: null,
    options:
      args.type === "dropdown"
        ? { choices: ["Option 1", "Option 2"] }
        : args.type === "date"
          ? { defaultToday: true }
          : null,
  };
}

// Stable per-recipient tint. Eight hue buckets walk around the wheel
// so adjacent signers are always visibly different. Sender-prefilled
// fields (recipientId === null) always use brand-accent so they read
// as "mine" across every editor viewport.
const ASSIGNEE_HUES = [200, 340, 80, 260, 25, 160, 300, 50];

export function colorFor(recipientId: string | null): string {
  if (!recipientId) return "var(--brand-accent)";
  // Cheap deterministic hash → bucket. We avoid Math.random and
  // window.crypto so the color is consistent SSR/CSR.
  let h = 0;
  for (let i = 0; i < recipientId.length; i += 1) {
    h = (h * 31 + recipientId.charCodeAt(i)) >>> 0;
  }
  const hue = ASSIGNEE_HUES[h % ASSIGNEE_HUES.length] ?? 200;
  return `hsl(${String(hue)} 70% 55%)`;
}

// True if the contract is sendable: at least one recipient, and every
// recipient has at least one required field assigned. The server
// enforces the same rule inside `send`; this is the client-side
// disabled-state check so we fail fast instead of round-tripping a
// guaranteed BAD_REQUEST.
export function canSend(args: {
  recipients: { id: string }[];
  fields: Pick<FieldLike, "recipientId" | "required">[];
}): boolean {
  if (args.recipients.length === 0) return false;
  for (const r of args.recipients) {
    const has = args.fields.some(
      (f) => f.recipientId === r.id && f.required,
    );
    if (!has) return false;
  }
  return true;
}
