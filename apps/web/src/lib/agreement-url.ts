export function isSafeAgreementUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function safeAgreementUrl(
  value: string | null | undefined,
): string | null {
  return value && isSafeAgreementUrl(value) ? value : null;
}
