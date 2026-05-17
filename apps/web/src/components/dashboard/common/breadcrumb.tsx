import Link from "next/link";
import { Fragment } from "react";

// Breadcrumb (PR #130, refined PR #136) — rendered exclusively inside
// the sticky DashboardTopBar. The top-level section crumb is always a
// Link back to the section root; intermediate crumbs are Links when
// the parent page has the needed id, otherwise plain text.
//
// Emil-pass polish notes:
//   • Separator is a hand-rolled 1.25-stroke SVG (not lucide's
//     ChevronRight) at --fg-faint — quieter than the crumb text so the
//     eye glides past it, treating it as a hint rather than a glyph.
//   • Single hover treatment: color shift only, with a custom ease-out
//     curve. Dropped the bg chip + underline — three hover effects
//     stacked competed with the search pill in the same row.
//   • Press feedback via :active scale-[0.98] + transform transition.
//   • Last crumb uses font-medium (500), not font-semibold (600). The
//     weight delta from intermediate (400) was too chunky; color +
//     gentle weight is more refined.
//
// Wrinkles still worth knowing:
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

// Custom separator — thinner than lucide's ChevronRight (stroke 2),
// optically closer to the typographic › glyph but rendered as SVG so
// we can set precise size/color independent of font metrics.
function CrumbSeparator() {
  return (
    <svg
      width="7"
      height="11"
      viewBox="0 0 7 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-[rgb(var(--fg-faint))]"
    >
      <polyline points="1.5 1 5.5 5.5 1.5 10" />
    </svg>
  );
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
        // gap-1.5 (6px) gives the chevron a touch more breathing room
        // than gap-1; the chevron now reads as a quiet separator.
        "flex min-w-0 flex-nowrap items-center gap-1.5 text-[13px]",
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
            {i > 0 ? <CrumbSeparator /> : null}
            {isClickable && item.href ? (
              <Link
                href={item.href}
                title={intermediateClipped ? item.label : undefined}
                // Single hover treatment: color shift only, with a
                // strong custom ease-out curve (cubic-bezier(0.23, 1,
                // 0.32, 1)). active:scale-[0.98] gives press feedback.
                // No bg chip, no underline — both competed with the
                // search pill's chip in the same row.
                className="max-w-[20ch] truncate rounded-[6px] px-1 py-0.5 text-[rgb(var(--fg-muted))] transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-[rgb(var(--fg-default))] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={
                  isLast
                    ? "max-w-[28ch] truncate font-medium text-[rgb(var(--fg-default))]"
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
