import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

// Breadcrumb (PR #130) — matches the HTML mockup's topbar crumbs row.
// We don't have a sticky topbar yet (AppShell-level work, deferred), so
// the crumbs live above the hero on each Clients & Projects deep page
// (Client Space, Album Page, Song Space). The top-level "Clients &
// Projects" crumb is always a Link back to the list; intermediate
// crumbs are Links when the parent page has the needed id, otherwise
// plain text.
//
// One unstyled wrinkle worth knowing: the last crumb is rendered as a
// <span aria-current="page"> regardless of whether `href` was provided.
// That's the standard pattern — the current page shouldn't be
// clickable, and screen readers want the aria-current cue.

export interface BreadcrumbCrumb {
  label: string;
  /** Omit to render plain text (also enforced for the last crumb). */
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbCrumb[];
  /** Optional className override for the wrapping nav. */
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;
  return (
    <nav
      aria-label="Breadcrumb"
      className={[
        "flex flex-wrap items-center gap-1 text-[12px]",
        className ?? "",
      ].join(" ")}
    >
      {items.map((item, i) => {
        const isLast = i === lastIndex;
        const isClickable = !isLast && Boolean(item.href);
        return (
          <Fragment key={`${String(i)}-${item.label}`}>
            {i > 0 ? (
              <ChevronRight
                size={11}
                strokeWidth={2.2}
                aria-hidden
                className="text-[rgb(var(--fg-faint))]"
              />
            ) : null}
            {isClickable && item.href ? (
              <Link
                href={item.href}
                className="rounded-[6px] px-1 py-0.5 text-[rgb(var(--fg-muted))] underline-offset-2 transition-colors hover:bg-[rgb(17_16_9/0.04)] hover:text-[rgb(var(--fg-default))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={
                  isLast
                    ? "max-w-[28ch] truncate font-semibold text-[rgb(var(--fg-default))]"
                    : "text-[rgb(var(--fg-muted))]"
                }
                title={isLast && item.label.length > 28 ? item.label : undefined}
              >
                {item.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
