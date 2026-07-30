export function ProducerHero({
  producerName,
  producerLogoUrl,
}: {
  producerName: string;
  producerLogoUrl: string | null;
}) {
  const initial = producerName.charAt(0).toUpperCase();

  return (
    <section
      aria-label={`${producerName} storefront`}
      className="reveal-up flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5 sm:px-5"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      {producerLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={producerLogoUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full border object-cover sm:h-12 sm:w-12"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        />
      ) : (
        <div
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--bg-sidebar))] font-display text-base font-bold text-[rgb(var(--fg-onsidebar))] sm:h-12 sm:w-12"
        >
          {initial}
        </div>
      )}
      <div className="min-w-0">
        <p className="font-mono text-[9px] font-semibold tracking-[0.16em] text-[rgb(var(--fg-muted))] uppercase">
          Services from
        </p>
        <h2 className="mt-0.5 truncate font-display text-[18px] leading-tight font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[20px]">
          {producerName}
        </h2>
      </div>
    </section>
  );
}
