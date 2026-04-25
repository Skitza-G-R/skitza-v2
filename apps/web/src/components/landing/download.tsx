// Download — DARK world. 2-card grid: Desktop (Tauri) and Mobile (PWA).
// Restyled in S3 to use landing.css `.download-grid` + `.download-card`
// + `.download-disabled` (all added to landing.css as part of S3). No
// Tailwind, no project tokens.
//
// Both platforms ship as honest "Coming soon" — the desktop binary
// requires a signed Tauri pipeline + Apple Developer cert (its own
// infra project) and the mobile PWA install affordance only fires on
// real iOS/Android, so a click-through here would 404 on cold visitors.
// We surface the platform stories so producers know they're coming
// without sending anyone to a broken download.
//
// Server component: pure JSX, no state.

const PLATFORMS = [
  {
    icon: "💻",
    title: "Desktop",
    sub: "Native app for macOS, Windows, and Linux. Drag-and-drop files straight from Finder, get global keyboard shortcuts, and keep working offline.",
  },
  {
    icon: "📱",
    title: "Mobile",
    sub: "Add to Home Screen on iOS or Android — works offline, ships push notifications, and keeps your client booking link one tap away.",
  },
] as const;

export function Download() {
  return (
    <section className="section" id="download">
      <div className="container">
        <div className="section-header no-cta reveal-up">
          <span className="watermark">09</span>
          <span className="label">Anywhere you work</span>
          <h2 className="syne">
            Studio. Sofa.<br />Subway.
          </h2>
          <p className="body-text" style={{ marginLeft: 0 }}>
            The web app is live today. Native desktop and mobile builds
            land the moment the signed-binary pipeline is in place — same
            account, same data, same one URL.
          </p>
        </div>

        <div className="download-grid">
          {PLATFORMS.map((p, i) => (
            <article
              key={p.title}
              className={`download-card reveal-up delay-${String(i + 1)}`}
            >
              <span className="download-icon" aria-hidden>
                {p.icon}
              </span>
              <h3 className="syne">{p.title}</h3>
              <p className="download-sub">{p.sub}</p>
              <button
                type="button"
                className="download-disabled"
                disabled
                aria-disabled="true"
              >
                <span aria-hidden>🔒</span> Coming soon
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
