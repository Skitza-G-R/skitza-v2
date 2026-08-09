export interface BankTransferFields {
  accountOwner: string;
  bank: string;
  branch: string;
  accountNumber: string;
}

export interface ParsedBankTransferDetails {
  fields: BankTransferFields;
  /**
   * Existing free-form instructions that cannot be represented safely by the
   * four onboarding fields. The client keeps the original value until the
   * producer deliberately edits a bank field.
   */
  preservedText: string | null;
}

export const EMPTY_BANK_TRANSFER_FIELDS: BankTransferFields = {
  accountOwner: "",
  bank: "",
  branch: "",
  accountNumber: "",
};

const FIELD_LABELS: ReadonlyArray<{
  key: keyof BankTransferFields;
  label: string;
  patterns: ReadonlyArray<RegExp>;
}> = [
  {
    key: "accountOwner",
    label: "Account owner",
    patterns: [/^account\s+(?:owner|name)\s*:\s*(.+)$/i, /^beneficiary\s*:\s*(.+)$/i],
  },
  {
    key: "bank",
    label: "Bank",
    patterns: [/^bank(?:\s+name)?\s*:\s*(.+)$/i],
  },
  {
    key: "branch",
    label: "Branch",
    patterns: [/^branch(?:\s+number)?\s*:\s*(.+)$/i],
  },
  {
    key: "accountNumber",
    label: "Account number",
    patterns: [/^account\s+(?:number|no\.?)\s*:\s*(.+)$/i, /^account\s*:\s*(.+)$/i],
  },
];

function matchBankTransferLine(candidate: string): {
  key: keyof BankTransferFields;
  value: string;
} | null {
  for (const { key, patterns } of FIELD_LABELS) {
    const match = patterns.map((pattern) => candidate.match(pattern)).find(Boolean);
    const value = match?.[1]?.trim();
    if (value) return { key, value };
  }

  return null;
}

export function serializeBankTransferDetails(
  fields: BankTransferFields,
  preservedSource?: string | null,
): string {
  const structuredLines = FIELD_LABELS.flatMap(({ key, label }) => {
    const value = fields[key].trim();
    return value ? [`${label}: ${value}`] : [];
  });
  const preservedLines = preservedSource
    ? preservedSource
        .trim()
        .split(/\r?\n/)
        .filter((line) => {
          const candidate = line.trim();
          return candidate.length > 0 && matchBankTransferLine(candidate) === null;
        })
    : [];

  return [...structuredLines, ...preservedLines].join("\n");
}

export function parseBankTransferDetails(raw: string): ParsedBankTransferDetails {
  const source = raw.trim();
  if (!source) {
    return {
      fields: { ...EMPTY_BANK_TRANSFER_FIELDS },
      preservedText: null,
    };
  }

  const fields = { ...EMPTY_BANK_TRANSFER_FIELDS };
  const unrecognizedLines: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) continue;

    const match = matchBankTransferLine(candidate);
    if (match) fields[match.key] = match.value;
    else unrecognizedLines.push(candidate);
  }

  return {
    fields,
    preservedText: unrecognizedLines.length > 0 ? source : null,
  };
}
