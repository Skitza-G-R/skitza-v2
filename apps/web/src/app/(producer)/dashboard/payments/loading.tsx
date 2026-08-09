export default function PaymentsLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading payments"
      className="mx-auto w-full max-w-[1320px] px-4 py-5 pb-28 motion-safe:animate-pulse sm:px-6 sm:py-8 lg:pb-10"
    >
      <p className="sr-only">Loading payments…</p>
      <div className="h-3 w-28 rounded-[var(--radius-sm)] bg-[rgb(var(--border-subtle))]" />
      <div className="mt-3 h-10 w-44 rounded-[var(--radius-md)] bg-[rgb(var(--border-subtle))]" />
      <div className="mt-3 h-4 w-full max-w-[480px] rounded-[var(--radius-sm)] bg-[rgb(var(--border-subtle))]" />
      <div className="mt-6 h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--border-subtle))] sm:h-9 sm:rounded-[var(--radius-md)]" />
      <div className="mt-4 h-44 rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]" />
      <div className="mt-4 divide-y divide-[rgb(var(--border-subtle))] border-y border-[rgb(var(--border-subtle))]">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-20" />
        ))}
      </div>
    </main>
  );
}
