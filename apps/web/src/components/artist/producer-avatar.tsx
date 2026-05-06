import { cn } from "~/lib/cn";
import {
  producerGradient,
  producerInitials,
} from "~/lib/artist/producer-color";

// Producer avatar — gradient monogram tile sized via prop. Default is
// a 32px rounded-square (matches activity-feed + recent-uploads list).
// `size` accepts an explicit pixel value for one-off sizes (e.g. 88
// on the desktop song-page hero); the rounded-* utility scales by
// caller class to keep tap-target rules consistent with `.sk-tap`.
//
// Pure server-renderable — no `"use client"`. Avoids hydration warnings
// from `Math.random()`/`Date.now()` because the gradient is hashed
// from the name string deterministically.

export function ProducerAvatar({
  name,
  size = 32,
  className,
  square = true,
  showInitials = true,
}: {
  name: string;
  size?: number;
  className?: string;
  square?: boolean;
  showInitials?: boolean;
}) {
  const initials = producerInitials(name);
  const gradient = producerGradient(name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center font-display font-extrabold text-white",
        square ? "rounded-[var(--radius-sm)]" : "rounded-full",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: gradient,
        fontSize,
        letterSpacing: "-0.02em",
      }}
    >
      {showInitials ? initials : null}
    </div>
  );
}
