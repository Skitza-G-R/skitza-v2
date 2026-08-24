// SK-273 — pure parsing for the founder's pasted beta list. Accepts the
// loose shapes a spreadsheet copy-paste produces: one entry per line, columns
// separated by tabs (spreadsheet paste), commas, or semicolons, in the fixed
// order `email, name, wave`. Extra columns are ignored; a header line naming
// "email" is skipped. Everything else that fails validation lands in
// `invalidLines` so the founder sees exactly what was rejected.

export type ParsedBetaRow = Readonly<{
  email: string;
  name: string | null;
  wave: number;
}>;

export type BetaListParseResult = Readonly<{
  duplicates: number;
  invalidLines: readonly string[];
  rows: readonly ParsedBetaRow[];
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const BETA_LIST_MAX_INPUT_LENGTH = 200_000;
export const BETA_LIST_MAX_ROWS = 1000;
export const BETA_MAX_WAVE = 99;

function splitLine(line: string): string[] {
  const delimiter = line.includes("\t") ? "\t" : line.includes(",") ? "," : ";";
  return line.split(delimiter).map((field) => field.trim().replace(/^"(.*)"$/, "$1").trim());
}

function isHeaderLine(fields: readonly string[]): boolean {
  // Exact header words only — a fuzzy "contains email" match would swallow
  // real typos like "not-an-email" as a header instead of rejecting them.
  const first = fields[0]?.toLowerCase() ?? "";
  return first === "email" || first === "e-mail" || first === "email address";
}

export function parseBetaListInput(raw: string): BetaListParseResult {
  const rows: ParsedBetaRow[] = [];
  const invalidLines: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const lines = raw.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const fields = splitLine(line);
    if (index === 0 && isHeaderLine(fields)) continue;

    if (rows.length >= BETA_LIST_MAX_ROWS) {
      invalidLines.push(line);
      continue;
    }

    const email = (fields[0] ?? "").toLowerCase();
    if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
      invalidLines.push(line);
      continue;
    }

    let wave = 1;
    const waveField = fields[2] ?? "";
    if (waveField.length > 0) {
      const parsed = Number(waveField);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > BETA_MAX_WAVE) {
        invalidLines.push(line);
        continue;
      }
      wave = parsed;
    }

    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);

    const nameField = (fields[1] ?? "").slice(0, 200);
    rows.push({ email, name: nameField.length > 0 ? nameField : null, wave });
  }

  return { duplicates, invalidLines, rows };
}

export function normalizedBetaEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function parsedBetaWave(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > BETA_MAX_WAVE) {
    return null;
  }
  return value;
}
