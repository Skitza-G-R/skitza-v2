"use client";

// Hero demo player. The earlier "standalone HTML" approach embedded
// a JS bundle that rendered a fake video player inside an iframe —
// noisy and unreliable. This is just a real <video> element with the
// founder's screen recording (apps/web/public/landing/demo.mp4),
// looped + muted + autoplay, no controls.
//
// `playsInline` is required for autoplay on iOS Safari. `preload` is
// "metadata" so the page-1 paint isn't blocked by the full ~20 MB
// download — the video starts streaming as soon as it scrolls into
// view (or when the user lingers near the hero).

export function DemoVideo({ title }: { title: string }) {
  return (
    <video
      className="get-started-demo-iframe"
      src="/landing/demo.mp4"
      title={title}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      aria-label={title}
    />
  );
}
