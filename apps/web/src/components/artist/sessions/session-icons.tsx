// Small icon used by the sessions screens that isn't in the shared funnel
// set. Same conventions as funnel-icons.tsx: pure presentational SVG,
// `currentColor` stroke so colour is driven by the surrounding text token.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function CalendarIcon(props: IconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </svg>
  );
}
