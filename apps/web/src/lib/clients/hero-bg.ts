// Dark hero gradient map — used by the dark gradient band behind
// the Client Space hero and the Album Page hero. Values verbatim
// from DESIGN.md §2 "Hero gradient map".

import type { GradientToken } from "./derive-gradient";

const MAP: Record<GradientToken, string> = {
  "grad-rose":    "linear-gradient(140deg,#5C1E26 0%, #7A2A20 50%, #B0381E 100%)",
  "grad-amber":   "linear-gradient(140deg,#3B2510 0%, #6B3F12 50%, #B06830 100%)",
  "grad-slate":   "linear-gradient(140deg,#1E2330 0%, #2B3142 50%, #3F4A60 100%)",
  "grad-violet":  "linear-gradient(140deg,#2B1C45 0%, #3B2868 50%, #5E3FAF 100%)",
  "grad-indigo":  "linear-gradient(140deg,#1B2353 0%, #2A3576 50%, #4252B0 100%)",
  "grad-emerald": "linear-gradient(140deg,#0F2C20 0%, #154A33 50%, #198455 100%)",
};

export function heroBg(token: GradientToken): string {
  return MAP[token];
}
