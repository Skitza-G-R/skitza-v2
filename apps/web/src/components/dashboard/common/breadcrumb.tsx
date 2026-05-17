import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

// Breadcrumb (PR #130) — matches the HTML mockup's topbar crumbs row.
// Now rendered exclusively inside the sticky DashboardTopBar (the
// previous in-hero usages were lifted into the topbar via the
// TopBarBreadcrumb context). The top-level section crumb is always a
// Link back to the section root; intermediate crumbs are Links when
// the parent page has the needed id, otherwise plain text.
//
// Wrinkles worth knowing:
//   • The LAST crumb renders as a <span aria-current="page"> regardless
//     of whether `href` was provided. Screen readers want the
//     aria-current cue and the current page shouldn't be clickable.
//   • Sized + truncated for the topbar use case: 13px text matches the
//     prior <h2> section label weight; intermediates cap at 20ch and
//     the last crumb caps at 28ch, both with `truncate` so long names
//     ellipsize instead of pushing the search pill or wrapping (which
//     would break the topbar's fixed py-2.5 height).

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
        // flex-nowrap + min-w-0 lets the topbar's outer flex container
        // shrink this nav (and its child Links/spans) below content
        // width — without min-w-0, the truncate classes are inert.
        "flex min-w-0 flex-nowrap items-center gap-1 text-[13px]",
        className ?? "",
      ].join(" ")}
    >
      {items.map((item, i) => {
        const isLast = i === lastIndex;
        const isClickable = !isLast && Boolean(item.href);
        // Intermediates cap at 20ch; last crumb caps at 28ch. Tooltip
        // on hover when the label was actually clipped — saves the
        // producer from having to navigate just to read the full name.
        const intermediateClipped = !isLast && item.label.length > 20;
        const lastClipped = isLast && item.label.length > 28;
        return (
          <Fragment key={`${String(i)}-${item.label}`}>
            {i > 0 ? (
              <ChevronRight
                size={12}
                strokeWidth={2}
                aria-hidden
                className="shrink-0 text-[rgb(var(--fg-muted))]"
              />
            ) : null}
            {isClickable && item.href ? (
              <Link
                href={item.href}
                title={intermediateClipped ? item.label : undefined}
                className="max-w-[20ch] truncate rounded-[6px] px-1 py-0.5 text-[rgb(var(--fg-muted))] underline-offset-2 transition-colors hover:bg-[rgb(17_16_9/0.04)] hover:text-[rgb(var(--fg-default))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={
                  isLast
                    ? "max-w-[28ch] truncate font-semibold text-[rgb(var(--fg-default))]"
                    : "max-w-[20ch] truncate text-[rgb(var(--fg-muted))]"
                }
                title={
                  lastClipped
                    ? item.label
                    : intermediateClipped
                      ? item.label
                      : undefined
                }
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
