// Consolidation — verbatim port of source HTML lines 1663-1704.
//
// Server component: pure JSX. The "See Everything Skitza Does" CTA's
// onclick handler (source line 1701) is replaced with a plain <a>
// anchor href to #features — same UX (browser smooth-scroll via the
// `scroll-behavior: smooth` rule in landing.css), zero JS required.
export function Consolidation() {
  return (
    <section className="section" id="consolidation">
      <div className="container">
        <div
          className="section-header reveal-up"
          style={{ maxWidth: 700, margin: "0 auto 32px", textAlign: "center" }}
        >
          <span
            className="watermark"
            style={{
              left: "50%",
              transform: "translateX(-50%)",
              opacity: 0.3,
            }}
          >
            —
          </span>
          <span className="label">One tool. Full stop.</span>
          <h2 className="syne" style={{ color: "var(--light-bg)" }}>
            Cancel the rest.<br />Skitza is the only<br />tab you need open.
          </h2>
          <p className="body-text">
            Most producers juggle multiple tools that barely talk to each
            other. Skitza replaces all of them — one subscription, one login,
            one place where everything just works.
          </p>
        </div>

        <div className="stats-grid reveal-up delay-1">
          <div className="stat-card">
            <div className="stat-num">9+</div>
            <div className="stat-label">tools replaced</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">1</div>
            <div className="stat-label">subscription</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">0</div>
            <div className="stat-label">new apps to learn</div>
          </div>
        </div>

        <div className="consolidation-footer reveal-up delay-2">
          <div className="tools-replaced">
            <div className="tool-chip replaced">
              <span className="tool-icon">💬</span> WhatsApp
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">🔗</span> Linktree
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">✍️</span> DocuSign
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">📤</span> WeTransfer
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">📊</span> Google Sheets
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">💸</span> PayPal / Wave
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">📁</span> Google Drive
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">📧</span> Gmail drafts
            </div>
            <div className="tool-chip replaced">
              <span className="tool-icon">📅</span> Calendly
            </div>
            <div className="tool-chip skitza">
              <span className="tool-icon">⚡</span> Skitza
            </div>
          </div>
          <p
            style={{
              color: "var(--dark-body)",
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            One subscription. One login. Zero context-switching.
          </p>
          <a href="#features" className="btn-ghost dark-ghost">
            See Everything Skitza Does →
          </a>
        </div>
      </div>
    </section>
  );
}
