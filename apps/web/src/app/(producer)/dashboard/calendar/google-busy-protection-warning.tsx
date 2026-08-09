export function GoogleBusyProtectionWarning({ embedded = false }: { embedded?: boolean }) {
  return (
    <div
      role="status"
      className={[
        "flex shrink-0 items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.28)] bg-[rgb(var(--fg-warning)/0.09)] px-3.5 py-3 text-[rgb(var(--fg-warning-text))] sm:px-4",
        embedded ? "mt-5" : "mb-3",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--fg-warning)/0.3)] bg-[rgb(var(--bg-elevated))] font-mono text-[12px] font-extrabold"
      >
        !
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold">Google busy-time check is limited</p>
        <p className="mt-0.5 text-[12px] leading-relaxed">
          Booking stays open using your Skitza availability. Google busy times may not be blocked
          until the connection recovers.
        </p>
      </div>
    </div>
  );
}
