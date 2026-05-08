// Stack-reveal — 5 chips for the legacy stack (WhatsApp, Drive,
// Notion, DocuSign, Stripe) merge into 1 amber Skitza chip on an
// 8-second loop.
//
// We use 2-letter abbreviations rather than the real wordmarks —
// avoids trademark headaches and keeps the visual quiet enough that
// it doesn't compete with the headline above it.

const LEGACY_TOOLS = [
  { abbr: "WA", label: "WhatsApp" },
  { abbr: "GD", label: "Google Drive" },
  { abbr: "NO", label: "Notion" },
  { abbr: "DS", label: "DocuSign" },
  { abbr: "ST", label: "Stripe" },
] as const;

export function StackReveal() {
  return (
    <div
      className="stack-reveal"
      role="img"
      aria-label="Replaces 5 tools with 1"
    >
      <div className="stack-reveal__logos">
        {LEGACY_TOOLS.map((tool, i) => (
          <div
            key={tool.abbr}
            className="stack-reveal__logo"
            style={{ animationDelay: `${String(i * 0.15)}s` }}
            aria-hidden
          >
            {tool.abbr}
          </div>
        ))}
      </div>
      <div className="stack-reveal__skitza" aria-hidden>S</div>
    </div>
  );
}
