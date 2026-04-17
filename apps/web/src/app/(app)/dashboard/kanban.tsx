"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useCallback, useMemo, useState, useTransition, type CSSProperties } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

import { setStageAction } from "./kanban-actions";
import {
  STAGES,
  STAGE_CTA,
  STAGE_LABEL,
  type Stage,
  droppableIdForStage,
  formatRelativeTime,
  stageFromDroppableId,
} from "./kanban-helpers";

// Pipeline Kanban — the producer's default view at /dashboard.
// Columns map 1:1 to the deal_stage pg enum. Drag-and-drop uses
// @dnd-kit/core (already installed). State is optimistic: a drop
// updates local state immediately, then awaits the Server Action and
// reverts on failure.

export interface KanbanDeal {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  clientName: string | null;
  updatedAt: Date;
}

interface KanbanProps {
  initial: Record<Stage, KanbanDeal[]>;
}

export function Kanban({ initial }: KanbanProps) {
  const [grouped, setGrouped] = useState<Record<Stage, KanbanDeal[]>>(initial);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const total = useMemo(
    () => STAGES.reduce((acc, s) => acc + grouped[s].length, 0),
    [grouped],
  );

  // PointerSensor with a small activation distance lets users click
  // cards (the CTA link, etc.) without the drag kicking in on a
  // stationary press. 6px feels right on both mouse and trackpad.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingId(null);
      const { active, over } = event;
      if (!over) return;
      const dealId = String(active.id);
      const targetStage = stageFromDroppableId(over.id as string);
      if (!targetStage) return;

      // Determine sourceStage by scanning the CURRENT state inside the
      // functional updater — avoids a stale closure over `grouped` that
      // could point at a pre-drag snapshot when drags are queued.
      // `capturedSource` is typed via a ref-like object so TS doesn't
      // narrow it to the initializer's `null` after the callback runs.
      const captured: { stage: Stage | null } = { stage: null };
      setGrouped((cur) => {
        let sourceStage: Stage | null = null;
        for (const s of STAGES) {
          if (cur[s].some((d) => d.id === dealId)) {
            sourceStage = s;
            break;
          }
        }
        if (sourceStage === null || sourceStage === targetStage) return cur;
        const card = cur[sourceStage].find((d) => d.id === dealId);
        if (!card) return cur;
        captured.stage = sourceStage;
        // Optimistic move: prepend to target (mirrors server's
        // desc(updatedAt) ordering — the moved card was just touched).
        return {
          ...cur,
          [sourceStage]: cur[sourceStage].filter((d) => d.id !== dealId),
          [targetStage]: [
            { ...card, stage: targetStage, updatedAt: new Date() },
            ...cur[targetStage],
          ],
        };
      });

      const revertStage = captured.stage;
      if (revertStage === null) return;

      startTransition(() => {
        void setStageAction({ id: dealId, stage: targetStage }).then((res) => {
          if (!res.ok) {
            // Revert ONLY this card, against current state — not a stale
            // snapshot that could clobber other successful moves.
            setGrouped((cur) => {
              const card = cur[targetStage].find((d) => d.id === dealId);
              if (!card) return cur; // Already moved elsewhere; leave alone.
              return {
                ...cur,
                [targetStage]: cur[targetStage].filter((d) => d.id !== dealId),
                [revertStage]: [
                  { ...card, stage: revertStage },
                  ...cur[revertStage],
                ],
              };
            });
            toast(res.error, "error");
          }
        });
      });
    },
    [toast],
  );

  if (total === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-6 py-12 text-center">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Pipeline
        </p>
        <h2 className="font-display text-2xl leading-tight tracking-tight">
          Your pipeline is empty.
        </h2>
        <p className="max-w-sm text-sm text-[rgb(var(--fg-secondary))]">
          Create your first deal — tracks, versions, feedback, contract, invoices all live
          inside. Share one URL with the artist.
        </p>
        <Link href="/dashboard/deals/new">
          <Button>Create first deal</Button>
        </Link>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => { onDragStart(String(e.active.id)); }}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setDraggingId(null); }}
    >
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex snap-x snap-mandatory gap-3 sm:snap-none">
          {STAGES.map((stage) => (
            <Column
              key={stage}
              stage={stage}
              items={grouped[stage]}
              draggingId={draggingId}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function Column({
  stage,
  items,
  draggingId,
}: {
  stage: Stage;
  items: KanbanDeal[];
  draggingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableIdForStage(stage) });
  const active = draggingId !== null;
  return (
    <section
      aria-label={STAGE_LABEL[stage]}
      className="flex w-[88vw] shrink-0 snap-center flex-col sm:w-[260px] sm:snap-align-none"
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <h2 className="font-display text-sm font-semibold tracking-tight text-[rgb(var(--fg-primary))]">
          {STAGE_LABEL[stage]}
          <span className="ml-2 font-mono text-[0.72rem] font-normal text-[rgb(var(--fg-muted))]">
            · {items.length}
          </span>
        </h2>
        <Link
          href={{ pathname: "/dashboard/deals/new", query: { stage } }}
          aria-label={`New deal in ${STAGE_LABEL[stage]}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-primary))]"
        >
          +
        </Link>
      </header>
      <div
        ref={setNodeRef}
        className={[
          "flex min-h-[120px] flex-1 flex-col gap-3 rounded-[var(--radius-lg)] border p-3 transition-colors",
          isOver
            ? "border-[rgb(var(--brand-primary)/0.45)] bg-[rgb(var(--brand-primary)/0.06)]"
            : active
              ? "border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))]"
              : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))]",
        ].join(" ")}
      >
        {items.length === 0 ? (
          <p className="mt-6 text-center font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            Drop deals here
          </p>
        ) : (
          items.map((deal) => <DealCard key={deal.id} deal={deal} />)
        )}
      </div>
    </section>
  );
}

function DealCard({ deal }: { deal: KanbanDeal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });

  // dnd-kit's transform is applied inline — we layer a tiny rotation on
  // top while dragging for a tactile "picked up" feel.
  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x.toString()}px, ${transform.y.toString()}px, 0) rotate(${(isDragging ? 2 : 0).toString()}deg)`,
      }
    : undefined;

  // artistName is non-null on the row, but the schema allows clientName
  // to override it — nullish-chain keeps the fallback wording without
  // upsetting the linter.
  const clientLabel = deal.clientName ?? deal.artistName;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        "group cursor-grab touch-none rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 transition-shadow",
        isDragging
          ? "cursor-grabbing shadow-[var(--shadow-md)] ring-1 ring-[rgb(var(--brand-primary)/0.5)]"
          : "hover:border-[rgb(var(--border-strong))] hover:shadow-[var(--shadow-sm)]",
      ].join(" ")}
    >
      <p className="line-clamp-2 text-sm font-semibold text-[rgb(var(--fg-primary))]">
        {deal.title}
      </p>
      <p className="mt-1 truncate font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))]">
        {clientLabel}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
          {formatRelativeTime(deal.updatedAt)}
        </span>
        <Link
          href={`/dashboard/deals/${deal.id}`}
          prefetch
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); }}
          className="font-mono text-[0.66rem] text-[rgb(var(--fg-secondary))] underline-offset-4 hover:text-[rgb(var(--brand-primary))] hover:underline"
        >
          {STAGE_CTA[deal.stage]} →
        </Link>
      </div>
    </article>
  );
}
