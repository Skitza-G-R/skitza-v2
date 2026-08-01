"use client";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-mark" aria-hidden="true">
          S
        </div>
        <p className="eyebrow" style={{ marginTop: "1.5rem" }}>
          Admin unavailable
        </p>
        <h1 className="access-title">Access stopped safely.</h1>
        <p className="access-copy">
          The admin configuration could not be verified. No environment was
          opened.
        </p>
        <button
          className="primary-button"
          style={{ marginTop: "1.5rem" }}
          type="button"
          onClick={reset}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
