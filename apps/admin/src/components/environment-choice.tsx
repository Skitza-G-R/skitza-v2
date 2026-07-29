const OPTIONS = [
  {
    copy: "Demo of the future Live workspace. No customer data or actions are connected.",
    id: "live",
    title: "Preview Live",
  },
  {
    copy: "Demo of the future Test workspace. No real data or actions are connected.",
    id: "test",
    title: "Preview Test",
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
          Choose which future environment to review. Both views currently use demo data and
          disconnected actions.
        </p>
        <div className="environment-choice-grid">
          {OPTIONS.map((option) => (
            <a className="environment-choice-option" href={`/${option.id}`} key={option.id}>
              <span className="choice-label" data-environment={option.id}>
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
