// Demo section. Embeds the founder's standalone HTML demo
// (apps/web/public/landing/demo.html) inside an iframe.
//
// Why an iframe rather than inlining: the demo is a self-contained
// bundler with its own CSS, fonts, and JS. Inlining it would mean
// porting hundreds of CSS rules + scripts into React — risky and
// loses the founder's exact visual fidelity. An iframe gives perfect
// 1:1 fidelity with zero porting work.
//
// loading="lazy" defers the load until the iframe scrolls near the
// viewport — same effect as the IntersectionObserver in the previous
// <video>-based version, with one less moving part.
//
// Pre-launch: drop a refreshed demo.html into apps/web/public/landing/
// to update it.

export function DemoVideoSection() {
  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight text-[rgb(var(--fg-primary))] sm:text-3xl">
        See it in action.
      </h2>
      <div className="get-started-demo-frame">
        <iframe
          src="/landing/demo.html"
          title="Skitza app demo: producer creates session, artist books, payment confirmed"
          loading="lazy"
          className="get-started-demo-frame__iframe"
          allow="autoplay"
        />
      </div>
    </div>
  );
}
