"use client";

import { useState } from "react";

// Founder portrait. Tries /landing/founder.jpg first; if the file is
// not on disk yet (404) the onError callback hides the broken-image
// icon and the gradient + GA initials underneath show through. This
// lets the founder drop the real photo into apps/web/public/landing/
// any time without a code change — the page renders either way.

export function FounderPhoto({ alt }: { alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="relative mx-auto h-32 w-32 overflow-hidden rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] sm:h-44 sm:w-44"
      aria-label={alt}
    >
      {/* Initials placeholder — visible until/unless the photo loads */}
      <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-[rgb(var(--fg-inverse))]">
        GA
      </div>
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- we don't want next/image's processing here; a static public asset with graceful 404-fallback is the right primitive
        <img
          src="/landing/founder.jpg"
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => {
            setLoaded(true);
          }}
          onError={() => {
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
