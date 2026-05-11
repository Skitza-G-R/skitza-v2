// use-drag-reorder.ts
//
// Native HTML5 drag-and-drop state machine for the Store catalog.
//
// Pure UI plumbing: tracks the dragging row + the current drop target
// (target id + "above" / "below"). The consumer (StoreScreen) owns the
// optimistic list state and the server call. We deliberately don't call
// the server here — keeping the hook synchronous-only means tests stay
// pure and the consumer can revert on error without coupling.
//
// `computeNewOrder` is exported so it can be unit-tested in isolation:
// move `fromId` immediately above-or-below `toId` in the array, no-op
// when ids are equal or missing.

"use client";

import { useCallback, useState } from "react";

export type DropPosition = "above" | "below";

export interface DropTarget {
  id: string | null;
  position: DropPosition | null;
}

export interface UseDragReorderArgs {
  onReorder: (fromId: string, toId: string, position: DropPosition) => void;
}

export interface DragRowHandlers {
  isDragging: boolean;
  dropPosition: DropPosition | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export function computeNewOrder(
  ids: readonly string[],
  fromId: string,
  toId: string,
  position: DropPosition,
): string[] {
  if (fromId === toId) return [...ids];
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1) return [...ids];
  const without = ids.filter((id) => id !== fromId);
  const targetIdx = without.indexOf(toId);
  const insertAt = position === "above" ? targetIdx : targetIdx + 1;
  return [
    ...without.slice(0, insertAt),
    fromId,
    ...without.slice(insertAt),
  ];
}

export function useDragReorder({ onReorder }: UseDragReorderArgs) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>({
    id: null,
    position: null,
  });

  const reset = useCallback(() => {
    setDragId(null);
    setDropTarget({ id: null, position: null });
  }, []);

  const getHandlersFor = useCallback(
    (rowId: string): DragRowHandlers => ({
      isDragging: dragId === rowId,
      dropPosition: dropTarget.id === rowId ? dropTarget.position : null,
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", rowId);
        setDragId(rowId);
      },
      onDragOver: (e) => {
        if (!dragId || dragId === rowId) return;
        e.preventDefault();
        // Decide above-or-below by which half of the row the cursor is in.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const isAbove = e.clientY < rect.top + rect.height / 2;
        const next: DropPosition = isAbove ? "above" : "below";
        setDropTarget((prev) =>
          prev.id === rowId && prev.position === next ? prev : { id: rowId, position: next },
        );
      },
      onDragEnd: () => {
        reset();
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragId;
        const position = dropTarget.position;
        if (from && position && from !== rowId) {
          onReorder(from, rowId, position);
        }
        reset();
      },
    }),
    [dragId, dropTarget, onReorder, reset],
  );

  return { getHandlersFor };
}
