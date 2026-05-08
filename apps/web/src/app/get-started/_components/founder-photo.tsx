"use client";

import { useState } from "react";

// Founder portrait. Renders the photo OPAQUE by default — if the
// asset 404s, onError hides the <img> and the gradient + GA initials
// underneath show through. Default-opaque means SSR + reduced-motion
// + no-JS visitors see the photo without waiting for an onLoad
// handler that might never fire if hydration is delayed.

export function FounderPhoto({ alt }: { alt: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="founder__portrait" aria-label={alt}>
      <div className="founder__portrait-initials">GA</div>
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- public-folder static asset with graceful 404 fallback
        <img
          className="founder__portrait-photo"
          src="/landing/founder.jpg"
          alt=""
          aria-hidden
          onError={() => {
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
