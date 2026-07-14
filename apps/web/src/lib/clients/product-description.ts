export function productDescriptionForDisplay(description: string | null): string | null {
  if (!description) return null;
  let value = description.trim();
  if (!value) return null;

  if (value.startsWith("---")) {
    const closingMarker = value.indexOf("\n---", 3);
    if (closingMarker === -1) return null;
    value = value.slice(closingMarker + 4).trim();
  }

  return value || null;
}
