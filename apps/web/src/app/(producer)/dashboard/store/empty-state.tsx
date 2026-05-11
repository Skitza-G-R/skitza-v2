// empty-state.tsx
//
// Dashed-border empty card shown when the catalog is empty or when a
// filter/search returns zero results. Action prop is rendered on the
// right of the body so the parent can pass either the new-product CTA
// or a "Clear filter" link.

import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-[16px] border border-dashed border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated)/0.6)] px-6 py-10 text-center">
      <p className="font-display text-[18px] font-extrabold tracking-tight text-[rgb(var(--fg-default))]">
        {title}
      </p>
      <p className="mx-auto mt-1 max-w-[40ch] text-[13px] text-[rgb(var(--fg-muted))]">
        {body}
      </p>
      {action ? <div className="mt-4 inline-flex justify-center">{action}</div> : null}
    </div>
  );
}
