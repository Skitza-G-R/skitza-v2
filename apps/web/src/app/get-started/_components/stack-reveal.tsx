// Stack-reveal animation — 5 monochrome chips for the legacy stack
// (WhatsApp, Drive, Notion, DocuSign, Stripe) shrink and fade out;
// a single Skitza chip fades in to take their place. 8s loop.
//
// We use plain 2-letter abbreviations rather than the real wordmarks
// so we don't need trademark permissions and the visual stays light.

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
      className="get-started-stack"
      role="img"
      aria-label="Replaces 5 tools with 1"
    >
      <div className="get-started-stack__logos">
        {LEGACY_TOOLS.map((tool, i) => (
          <div
            key={tool.abbr}
            className="get-started-stack__logo"
            style={{ animationDelay: `${String(i * 0.15)}s` }}
            aria-hidden
          >
            {tool.abbr}
          </div>
        ))}
      </div>
      <div className="get-started-stack__skitza" aria-hidden>
        S
      </div>
    </div>
  );
}
