import Link from "next/link";

import type { VolumeTier } from "~/lib/pricing";
import { formatPriceLabel } from "~/lib/store/format-price-label";

// "Also from {Producer}" — the quiet tail under the focal card.
// Borderless rows with hairline dividers, whole row tappable. Meta
// trimmed to one short signal per row since the focal card already
// taught the artist what each product type looks like.
export function QuietProductList({
  producerName,
  products,
}: {
  producerName: string;
  products: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    sessionCount: number | null;
    durationMin: number | null;
  }[];
}) {
  if (products.length === 0) return null;

  return (
    <section className="reveal-up">
      <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Also from {producerName}
      </p>
      <ul
        className="overflow-hidden rounded-[var(--radius-lg)]"
        style={{
          background: "rgb(var(--bg-elevated))",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {products.map((product, i) => {
          const isLast = i === products.length - 1;
          const meta = shortMeta(product);
          return (
            <li key={product.id}>
              <Link
                href={`/artist/store/${product.id}`}
                className={`sk-press flex items-baseline justify-between gap-3 px-4 py-3.5 ${
                  isLast ? "" : "border-b"
                }`}
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                    {product.name}
                  </p>
                  {meta ? (
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                      {meta}
                    </p>
                  ) : null}
                </div>
                <span
                  className="shrink-0 font-mono text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))]"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {formatPriceLabel(product)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shortMeta(product: {
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  sessionCount: number | null;
  durationMin: number | null;
}): string | null {
  if (product.pricingModel === "per_song") return "PER SONG";
  if (product.pricingModel === "hourly") {
    return product.durationMin
      ? `${String(product.durationMin)} MIN`
      : "PER HOUR";
  }
  if (product.sessionCount && product.sessionCount > 0) {
    return `${String(product.sessionCount)}× SESSION${product.sessionCount > 1 ? "S" : ""}`;
  }
  if (product.durationMin) return `${String(product.durationMin)} MIN`;
  return null;
}
