const OPTIONS = [
  {
    copy: "Real customer context. The red banner remains visible on every screen.",
    id: "live",
    title: "Open Live",
  },
  {
    copy: "Isolated test context. No Live data or action can enter this view.",
    id: "test",
    title: "Open Test",
  },
] as const;

export function EnvironmentChoice() {
  return (
    <div className="environment-choice">
      <section className="environment-choice-card">
        <p className="eyebrow">Choose data context</p>
        <h1 className="shell-title" style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>
          Live and Test never mix.
        </h1>
        <p className="shell-subtitle">
          Select an explicit environment before the protected admin context is
          opened.
        </p>
        <div className="environment-choice-grid">
          {OPTIONS.map((option) => (
            <a
              className="environment-choice-option"
              href={`/?environment=${option.id}`}
              key={option.id}
            >
              <span
                className="choice-label"
                data-environment={option.id}
              >
                {option.id}
              </span>
              <h2 className="choice-title">{option.title}</h2>
              <p className="choice-copy">{option.copy}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
