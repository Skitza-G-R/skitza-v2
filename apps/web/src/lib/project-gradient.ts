// Deterministic gradient picker for project badges.
//
// The HTML mockup gives every project a colored gradient swatch
// (rose / amber / slate / emerald / violet / indigo / sky / lime).
// Our `projects` row doesn't carry a color column — so we hash the
// project id into one of the gradient buckets. Same id always lands
// on the same gradient, so the badge identity stays stable across
// renders and across surfaces (list row, hero, breadcrumb, etc.).

export const PROJECT_GRADIENTS = [
  "rose",
  "amber",
  "slate",
  "emerald",
  "violet",
  "indigo",
  "sky",
  "lime",
] as const;

export type ProjectGradient = (typeof PROJECT_GRADIENTS)[number];

// Tailwind-arbitrary-friendly gradient definitions. Each pair is the
// `from` and `to` color in `linear-gradient(135deg, FROM, TO)`. We
// keep them as raw rgb so callers can use them in inline styles or
// className arbitrary values without taking a Tailwind dependency.
export const GRADIENT_STOPS: Record<ProjectGradient, [string, string]> = {
  rose: ["#fb7185", "#ef4444"],
  amber: ["#fcd34d", "#fb923c"],
  slate: ["#cbd5e1", "#94a3b8"],
  emerald: ["#6ee7b7", "#10b981"],
  violet: ["#c4b5fd", "#8b5cf6"],
  indigo: ["#a5b4fc", "#6366f1"],
  sky: ["#7dd3fc", "#0ea5e9"],
  lime: ["#bef264", "#65a30d"],
};

// Stable string hash → integer. djb2 variant (small, no deps, good
// distribution for short ids). We don't need cryptographic strength
// here — the only requirement is "same id → same bucket".
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function gradientFor(projectId: string): ProjectGradient {
  const idx = hashString(projectId) % PROJECT_GRADIENTS.length;
  return PROJECT_GRADIENTS[idx] ?? "amber";
}

export function gradientCss(gradient: ProjectGradient): string {
  const [from, to] = GRADIENT_STOPS[gradient];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
