import Link from "next/link";

// FinalCTA — verbatim port of source HTML lines 1798-1809.
//
// Server component: pure JSX. The original "Join The Waiting List"
// button → <Link> "Sign up now" pointing at /sign-up with the
// onboarding redirect (PRD §3.5: friction kills conversion; pain
// collection moves into /onboarding instead of a modal).
export function FinalCTA() {
  return (
    <section className="final-cta">
      <div className="final-glow" />
      <div className="container">
        <span
          className="label"
          style={{ position: "relative", zIndex: 1 }}
        >
          Ready?
        </span>
        <h2 className="syne">
          The studio that<br />runs itself is here.
        </h2>
        <p
          className="body-text"
          style={{ position: "relative", zIndex: 1 }}
        >
          Stop spending hours on admin.
          <br />
          Make the music you actually want to make.
        </p>
        <div className="final-ctas">
          <Link
            href="/sign-up?redirect_url=%2Fonboarding"
            className="btn-primary"
          >
            Sign up now
          </Link>
        </div>
      </div>
    </section>
  );
}
