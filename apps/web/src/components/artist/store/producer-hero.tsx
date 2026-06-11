import { producerHue } from "~/lib/_phase4-stubs/producer-color";

// Boutique storefront header for /artist/store. Warm brand-primary →
// copper cover band with the same radial-vignette depth as the S3
// funnel's product cover, with the producer's logo (or initial
// fallback) as a circle that overlaps the bottom edge of the gradient
// onto the elevated card below. Name in display font under the logo.
export function ProducerHero({
  producerName,
  producerLogoUrl,
}: {
  producerName: string;
  producerLogoUrl: string | null;
}) {
  const initial = producerName.charAt(0).toUpperCase();
  // Darkened producer-hue monogram (same deterministic hue the S3
  // funnel's avatar swatch uses) so the cream initial stays readable
  // against the warm band — the old brand-primary/0.7 fill washed out
  // on top of the amber gradient.
  const hue = producerHue(producerName);
  const monogramGradient = `linear-gradient(145deg, oklch(0.52 0.12 ${String(hue)}) 0%, oklch(0.33 0.11 ${String((hue + 30) % 360)}) 100%)`;
  return (
    <section
      aria-label={`${producerName} storefront`}
      className="reveal-up overflow-hidden rounded-[var(--radius-2xl)]"
      style={{
        background: "rgb(var(--bg-elevated))",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* cover band — vignette + top sheen layered over the warm
          brand gradient (the S3 cover treatment's visual language),
          kept tight so the band reads as cover art, not dead space */}
      <div
        aria-hidden
        className="h-24 sm:h-28"
        style={{
          background:
            "radial-gradient(90% 130% at 14% -10%, rgb(255 255 255 / 0.26) 0%, rgb(255 255 255 / 0) 52%), radial-gradient(125% 115% at 50% 6%, transparent 42%, rgb(17 16 9 / 0.32) 100%), linear-gradient(160deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
        }}
      />
      <div className="relative px-5 pb-5 pt-10 sm:px-6 sm:pb-6 sm:pt-12">
        {/* Ring color matches the card surface so the circle reads as
            "punched through" the gradient instead of floated. It must sit
            on the ringed elements themselves — Tailwind v4 registers
            --tw-ring-color with `inherits: false`, so a parent value
            never reaches the child. */}
        <div className="absolute -top-8 left-5 sm:-top-10 sm:left-6">
          {producerLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={producerLogoUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-4 ring-[rgb(var(--bg-elevated))] sm:h-20 sm:w-20"
              style={{ boxShadow: "0 8px 20px -6px rgb(122 72 30 / 0.45)" }}
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full font-display text-2xl font-bold text-[rgb(var(--fg-inverse))] ring-4 ring-[rgb(var(--bg-elevated))] sm:h-20 sm:w-20"
              style={{
                background: monogramGradient,
                boxShadow: "0 8px 20px -6px rgb(122 72 30 / 0.45)",
              }}
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
