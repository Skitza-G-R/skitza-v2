// Both workspaces are connected to a real database and a real Clerk instance —
// Live to production, Test to the isolated test copies. The earlier copy called
// both a demo with nothing connected, which is no longer true and could make a
// founder treat a real invitation wave as a rehearsal.
const OPTIONS = [
  {
    copy: "Production data and real producers. Invitations sent here reach real people.",
    id: "live",
    title: "Live workspace",
  },
  {
    copy: "The isolated test database and test Clerk instance. Safe for rehearsals.",
    id: "test",
    title: "Test workspace",
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
          Choose which workspace to open. Each one is bound to its own database and its own sign-in
          instance, and they never share records.
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
