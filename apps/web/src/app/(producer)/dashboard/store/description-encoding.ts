// description-encoding.ts
//
// `products.description` doubles as both the public-page tagline AND
// (until a Phase-4 schema migration) the carrier for revisions +
// turnaround. This helper round-trips between the structured editor
// fields and the flat string. The format is line-based and stable:
//
//   <free-form body, can be multiple lines>
//   \n---\n
//   revisions: <int>
//   turnaround: <free text>
//
// Card-side `deriveTagline` already takes `description.split('\n')[0]`,
// so the meta block never leaks into the card UI.

const SEPARATOR = "\n---\n";

export interface DescriptionFields {
  tagline: string;
  revisions: number;
  turnaround: string;
}

export function encodeDescription({ tagline, revisions, turnaround }: DescriptionFields): string {
  const hasMeta = (revisions != null && revisions > 0) || turnaround.trim().length > 0;
  if (!hasMeta) return tagline;
  return `${tagline}${SEPARATOR}revisions: ${String(revisions ?? 0)}\nturnaround: ${turnaround}`;
}

export function decodeDescription(description: string | null): DescriptionFields {
  if (!description) return { tagline: "", revisions: 0, turnaround: "" };
  const idx = description.indexOf(SEPARATOR);
  if (idx === -1) return { tagline: description, revisions: 0, turnaround: "" };
  // Strip a single trailing newline so descriptions written with a blank line
  // before `---` decode the same as ones without (the encoder writes the
  // tight form; this keeps the decoder tolerant either way).
  const tagline = description.slice(0, idx).replace(/\n$/, "");
  const meta = description.slice(idx + SEPARATOR.length);
  const revisionsMatch = meta.match(/revisions:\s*(\d+)/);
  const turnaroundMatch = meta.match(/turnaround:\s*(.+?)(?:\n|$)/);
  return {
    tagline,
    revisions: revisionsMatch ? parseInt(revisionsMatch[1] ?? "0", 10) : 0,
    turnaround: turnaroundMatch ? (turnaroundMatch[1] ?? "").trim() : "",
  };
}
