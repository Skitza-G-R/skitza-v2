"use client";

// Pure-CSS confetti burst on /thanks mount. The animation is defined
// in apps/web/src/styles/get-started.css and gated by the
// `prefers-reduced-motion` block on `.get-started-root *` (Task 12),
// so reduced-motion users see a static state.
//
// "use client" only because it MUST be in the rendered tree of the
// thanks page (which is a server component). No client state — the
// element is a pure visual.

export function PostSignupConfetti() {
  return <div aria-hidden className="get-started-confetti" />;
}
