"use client";

// Animated 3-bar equalizer used to flag the currently-playing track in
// any list (Music Library L1, project room track rows, hover-cards).
// Mirrors the design source `notes/tabs/music.jsx`'s EqBars helper, but
// reuses the existing `.eq-bar` keyframe in `globals.css` so animation
// timing + the `prefers-reduced-motion` neutralizer are shared with
// every other equalizer indicator on the platform.
//
// `playing={false}` renders the same DOM in `.eq-paused` mode — bars
// frozen at 22% height. Same component, same layout, no flash on toggle.
//
// Sized via `size` (each bar's height when idle; the animation drives
// 20%–100% relative to this). Default 12px reads well at the size of a
// row's leading icon column without crowding adjacent text.

interface EqBarsProps {
  /** When true, bars animate. When false, frozen at 22% via `.eq-paused`. */
  playing: boolean;
  /** Height in px (default 12). Each bar's CSS height is 100% of this. */
  size?: number;
  /** Optional className (e.g. for color overrides — set `color` on parent). */
  className?: string;
  /** ARIA label. Defaults to "Now playing" / "Paused". */
  label?: string;
}

export function EqBars({
  playing,
  size = 12,
  className,
  label,
}: EqBarsProps) {
  return (
    <span
      role="img"
      aria-label={label ?? (playing ? "Now playing" : "Paused")}
      className={[
        "inline-flex items-end gap-[2px]",
        playing ? "" : "eq-paused",
        className ?? "",
      ].join(" ")}
      style={{ height: size, width: size + 4 }}
    >
      <span
        className="eq-bar"
        style={{
          width: 2,
          height: "100%",
          background: "currentColor",
          borderRadius: 1,
          animationDelay: "0s",
        }}
      />
      <span
        className="eq-bar"
        style={{
          width: 2,
          height: "100%",
          background: "currentColor",
          borderRadius: 1,
          animationDelay: "0.18s",
        }}
      />
      <span
        className="eq-bar"
        style={{
          width: 2,
          height: "100%",
          background: "currentColor",
          borderRadius: 1,
          animationDelay: "0.36s",
        }}
      />
    </span>
  );
}
