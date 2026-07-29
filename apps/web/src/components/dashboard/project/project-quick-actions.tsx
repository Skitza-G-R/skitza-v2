"use client";

import { Music2, Plus } from "lucide-react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

interface ProjectQuickActionsProps {
  projectName: string;
  canAddSong: boolean;
  blockedReason: string;
  onAddSong: () => void;
}

export function ProjectQuickActions({
  projectName,
  canAddSong,
  blockedReason,
  onAddSong,
}: ProjectQuickActionsProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Add to ${projectName}`}
          aria-haspopup="dialog"
          disabled={!canAddSong}
          title={canAddSong ? "Add to project" : blockedReason}
          className="sk-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))] shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={19} strokeWidth={2.4} aria-hidden />
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        data-testid="project-quick-actions"
        className="mx-auto max-w-[560px]"
      >
        <SheetHeader>
          <SheetTitle>Add to {projectName}</SheetTitle>
          <SheetDescription>Add a song to this project.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-2">
          <SheetClose asChild>
            <button
              type="button"
              aria-label="Add song"
              onClick={onAddSong}
              className="sk-press flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-4 text-left text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              <span
                aria-hidden
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.13)] text-[rgb(var(--brand-primary-dark))]"
              >
                <Music2 size={17} strokeWidth={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold">Add song</span>
                <span className="mt-0.5 block text-[12px] text-[rgb(var(--fg-muted))]">
                  Use an available purchased song space.
                </span>
              </span>
            </button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
