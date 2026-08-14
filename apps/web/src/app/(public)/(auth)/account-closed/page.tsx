export const metadata = { title: "Account closed" };

export default function AccountClosedPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-6 py-16 text-center">
      <div className="w-full">
        <p className="font-mono text-xs tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
          Account closed
        </p>
        <h1 className="font-syne mt-4 text-4xl font-extrabold tracking-tight text-[rgb(var(--fg-primary))]">
          This account is no longer active.
        </h1>
        <p className="mt-5 leading-relaxed text-[rgb(var(--fg-secondary))]">
          Your Skitza workspace and public profile are no longer active. If you think this is a
          mistake, email{" "}
          <a className="font-medium underline underline-offset-4" href="mailto:privacy@skitza.app">
            privacy@skitza.app
          </a>
          .
        </p>
      </div>
    </main>
  );
}
