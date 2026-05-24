// Boutique storefront header for /artist/store. Soft brand-primary →
// copper gradient cover, with the producer's logo (or initial fallback)
// as a circle that overlaps the bottom edge of the gradient onto the
// elevated card below. Name in display font under the logo.
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
      className="reveal-up overflow-hidden rounded-[var(--radius-2xl)]"
      style={{
        background: "rgb(var(--bg-elevated))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        aria-hidden
        className="h-32 sm:h-40"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
        }}
      />
      <div className="relative px-5 pb-6 pt-10 sm:px-6 sm:pb-7 sm:pt-12">
        <div
          className="absolute -top-8 left-5 sm:-top-10 sm:left-6"
          style={
            {
              // Ring color matches the card surface so the circle reads
              // as "punched through" the gradient instead of floated.
              "--tw-ring-color": "rgb(var(--bg-elevated))",
            } as React.CSSProperties
          }
        >
          {producerLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={producerLogoUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-4 sm:h-20 sm:w-20"
              style={{ boxShadow: "var(--shadow-sm)" }}
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary)/0.7)] to-[rgb(var(--brand-accent)/0.5)] font-display text-2xl font-bold text-[rgb(var(--fg-inverse))] ring-4 sm:h-20 sm:w-20"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              {initial}
            </div>
          )}
        </div>
        <h2 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[28px]">
          {producerName}
        </h2>
      </div>
    </section>
  );
}
