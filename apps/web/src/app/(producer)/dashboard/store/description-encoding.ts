// description-encoding.ts
//
// Round-trips four logical fields (tagline / revisions /
// unlimitedRevisions / legacy contract text) through the single
// `products.description` column. The schema still has no dedicated
// `revisions` column. Older products also encoded inline contract terms here,
// so the decoder retains that compatibility read while new saves move
// contract text into `products.agreementText`:
//
//     <tagline body, can be multiple lines>
//     ---
//     revisions: N            (or "revisions: unlimited" when the flag is set)
//     contract_text: <single-or-multi-line text terms>
//
// The card-side `deriveTagline` already takes `description.split('\n')[0]`,
// so the meta block never leaks onto the public profile card.
//
// New writes keep the contract_text slot empty and preserve only tagline plus
// revisions metadata. Changes here must keep old reads and edited round-trips
// lossless.

const SEPARATOR = "\n---\n";

export interface DescriptionFields {
  tagline: string;
  /** 0 when unlimitedRevisions is true; readers should check the flag first. */
  revisions: number;
  unlimitedRevisions: boolean;
  contractText: string;
}

export function encodeDescription({
  tagline,
  revisions,
  unlimitedRevisions,
  contractText,
}: DescriptionFields): string {
  const hasMeta =
    unlimitedRevisions || revisions > 0 || contractText.trim().length > 0;
  if (!hasMeta) return tagline;
  const revisionsLine = unlimitedRevisions
    ? "revisions: unlimited"
    : `revisions: ${String(revisions)}`;
  return `${tagline}${SEPARATOR}${revisionsLine}\ncontract_text: ${contractText}`;
}

export function decodeDescription(description: string | null): DescriptionFields {
  if (!description) {
    return { tagline: "", revisions: 0, unlimitedRevisions: false, contractText: "" };
  }
  const idx = description.indexOf(SEPARATOR);
  if (idx === -1) {
    return {
      tagline: description,
      revisions: 0,
      unlimitedRevisions: false,
      contractText: "",
    };
  }
  const tagline = description.slice(0, idx).replace(/\n$/, "");
  const meta = description.slice(idx + SEPARATOR.length);
  // Prefer the "unlimited" marker; fall back to a numeric value; default 0.
  const unlimitedMatch = meta.match(/revisions:\s*unlimited/i);
  const revMatch = meta.match(/revisions:\s*(\d+)/);
  // Greedy match for contract_text since it may have newlines.
  // Take everything after "contract_text:" up to the end of the string.
  const textMatch = meta.match(/contract_text:\s*([\s\S]*)$/);
  return {
    tagline,
    revisions: unlimitedMatch ? 0 : revMatch ? parseInt(revMatch[1] ?? "0", 10) : 0,
    unlimitedRevisions: !!unlimitedMatch,
    contractText: textMatch ? (textMatch[1] ?? "").trim() : "",
  };
}
