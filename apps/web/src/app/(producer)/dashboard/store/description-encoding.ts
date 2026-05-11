// description-encoding.ts
//
// Round-trips three logical fields (tagline / revisions / contract text)
// through the single `products.description` column. The schema does not
// yet have dedicated columns for `revisions` or for inline contract
// terms, so the wizard encodes them as a clearly-marked suffix block:
//
//     <tagline body, can be multiple lines>
//     ---
//     revisions: N
//     contract_text: <single-or-multi-line text terms>
//
// The card-side `deriveTagline` already takes `description.split('\n')[0]`,
// so the meta block never leaks onto the public profile card.
//
// When a future migration adds real columns, the wizard reads/writes
// them directly and this helper goes away. Until then: changes here
// must keep the round-trip lossless.

const SEPARATOR = "\n---\n";

export interface DescriptionFields {
  tagline: string;
  revisions: number;
  contractText: string;
}

export function encodeDescription({
  tagline,
  revisions,
  contractText,
}: DescriptionFields): string {
  const hasMeta = revisions > 0 || contractText.trim().length > 0;
  if (!hasMeta) return tagline;
  return `${tagline}${SEPARATOR}revisions: ${String(revisions)}\ncontract_text: ${contractText}`;
}

export function decodeDescription(description: string | null): DescriptionFields {
  if (!description) return { tagline: "", revisions: 0, contractText: "" };
  const idx = description.indexOf(SEPARATOR);
  if (idx === -1) return { tagline: description, revisions: 0, contractText: "" };
  const tagline = description.slice(0, idx).replace(/\n$/, "");
  const meta = description.slice(idx + SEPARATOR.length);
  const revMatch = meta.match(/revisions:\s*(\d+)/);
  // Greedy match for contract_text since it may have newlines.
  // Take everything after "contract_text:" up to the end of the string.
  const textMatch = meta.match(/contract_text:\s*([\s\S]*)$/);
  return {
    tagline,
    revisions: revMatch ? parseInt(revMatch[1] ?? "0", 10) : 0,
    contractText: textMatch ? (textMatch[1] ?? "").trim() : "",
  };
}
