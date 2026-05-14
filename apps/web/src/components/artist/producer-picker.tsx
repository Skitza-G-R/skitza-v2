"use client";

type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

export function ProducerPicker({
  studios,
  activeId,
  onSelect,
}: {
  studios: Studio[];
  activeId: string | null;
  onSelect: (producerId: string) => void;
}) {
  if (studios.length <= 1) return null;
  return (
    <div>
      <p className="mb-3 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Choose a producer
      </p>
      <div className="flex flex-wrap gap-5">
        {studios.map((studio) => (
          <button
            key={studio.producerId}
            type="button"
            onClick={() => {
              onSelect(studio.producerId);
            }}
            className={`flex flex-col items-center gap-1.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))] ${
              studio.producerId === activeId
                ? "opacity-100"
                : "opacity-50 hover:opacity-75"
            }`}
          >
            {studio.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={studio.logoUrl}
                alt=""
                className={`h-14 w-14 rounded-full object-cover ring-2 ${
                  studio.producerId === activeId
                    ? "ring-[rgb(var(--brand-primary))]"
                    : "ring-transparent"
                }`}
              />
            ) : (
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary)/0.7)] to-[rgb(var(--brand-accent)/0.5)] font-display text-xl font-bold text-[rgb(var(--fg-inverse))] ring-2 ${
                  studio.producerId === activeId
                    ? "ring-[rgb(var(--brand-primary))]"
                    : "ring-transparent"
                }`}
              >
                {studio.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="max-w-[64px] truncate text-center font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
              {studio.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
