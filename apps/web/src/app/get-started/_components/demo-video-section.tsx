"use client";

import { useEffect, useRef, useState } from "react";

// Demo video section. The phone-frame mockup is pure CSS (no PNG
// asset needed). The <video> only loads its sources once the section
// scrolls within 200 px of the viewport — saves the page-1 paint
// from a video-network round-trip.
//
// Pre-launch: real demo.webm / demo.mp4 / demo-poster.jpg are dropped
// into apps/web/public/landing/. Until then, the <video> shows an
// empty frame (poster missing → black background visible inside the
// phone). That's an acceptable interim state — the section's structure
// and copy ship first.

export function DemoVideoSection() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, []);

  return (
    <div className="mx-auto max-w-md">
      <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight text-[rgb(var(--fg-primary))] sm:text-3xl">
        See it in action.
      </h2>
      <div className="get-started-phone">
        <video
          ref={ref}
          poster="/landing/demo-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          aria-label="Skitza app demo: producer creates session, artist books, payment confirmed"
          className="get-started-phone__video"
        >
          {shouldLoad ? (
            <>
              <source src="/landing/demo.webm" type="video/webm" />
              <source src="/landing/demo.mp4" type="video/mp4" />
            </>
          ) : null}
        </video>
      </div>
    </div>
  );
}
