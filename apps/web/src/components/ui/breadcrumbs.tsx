import Link from "next/link";
import type { ReactNode } from "react";

// Editorial breadcrumb trail for deep dashboard surfaces. Each item
// renders as a `<Link>` unless it's the current page (no `href` →
// rendered as a span with aria-current="page"). The typography leans
// on the same `font-mono uppercase tracking-[0.18em] text-muted`
// eyebrow we use for section labels elsewhere (Today, Setup,
// Projects list) — small scale, light weight, so the breadcrumb
// reads as orientation chrome rather than competing with the page
// title that sits below it.
//
// Usage:
//   <Breadcrumbs
//     items={[
//       { label: "Projects", href: "/dashboard/projects" },
//       { label: project.title },  // current page — no href
//     ]}
//   />

export type BreadcrumbItem = {
  label: string;
  /** Omit for the current page; the final segment never links to itself. */
  href?: string;
};

export function Breadcrumbs({
  items,
  className = "",
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={[
        "font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="sk-trans text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  {...(isLast ? { "aria-current": "page" as const } : {})}
                  className={isLast ? "text-[rgb(var(--fg-primary))]" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <Separator />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Separator(): ReactNode {
  // `›` (U+203A) reads clearer at small type than the ASCII ">" and
  // matches the Samply / Linear breadcrumb vibe.
  return <span aria-hidden>›</span>;
}
