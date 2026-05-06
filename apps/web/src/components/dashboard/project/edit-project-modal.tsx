"use client";

// Edit-project modal — reachable from the Project Room header's 3-dot
// actions menu. Producer can adjust the project title and the artist's
// display name / email after creation. Stage stays out of this modal
// (the inline stage <select> in ProjectHeader is the canonical control).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { updateProjectAction } from "~/app/(producer)/dashboard/clients-projects/actions";

interface EditProjectModalProps {
  open: boolean;
  projectId: string;
  initialTitle: string;
  initialArtistName: string;
  initialArtistEmail: string;
  onClose: () => void;
}

export function EditProjectModal({
  open,
  projectId,
  initialTitle,
  initialArtistName,
  initialArtistEmail,
  onClose,
}: EditProjectModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [artistName, setArtistName] = useState(initialArtistName);
  const [artistEmail, setArtistEmail] = useState(initialArtistEmail);

  // Re-seed local state from the latest props every time the modal
  // opens. Otherwise stale edits from a cancelled session bleed into
  // the next open.
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setArtistName(initialArtistName);
      setArtistEmail(initialArtistEmail);
      setError(null);
    }
  }, [open, initialTitle, initialArtistName, initialArtistEmail]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  const trimmedTitle = title.trim();
  const trimmedName = artistName.trim();
  const trimmedEmail = artistEmail.trim();

  const dirty =
    trimmedTitle !== initialTitle ||
    trimmedName !== initialArtistName ||
    trimmedEmail !== initialArtistEmail;

  const valid =
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= 120 &&
    trimmedName.length > 0 &&
    trimmedName.length <= 80 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  async function onSave() {
    if (!dirty || !valid || pending) return;
    setPending(true);
    setError(null);
    // Build the patch payload without `undefined` keys —
    // `exactOptionalPropertyTypes` forbids them at the type level, and
    // it keeps the wire payload to fields that actually changed.
    const patch: {
      id: string;
      title?: string;
      artistName?: string;
      artistEmail?: string;
    } = { id: projectId };
    if (trimmedTitle !== initialTitle) patch.title = trimmedTitle;
    if (trimmedName !== initialArtistName) patch.artistName = trimmedName;
    if (trimmedEmail !== initialArtistEmail) patch.artistEmail = trimmedEmail;
    const res = await updateProjectAction(patch);
    setPending(false);
    if (res.ok) {
      toast("Project updated.", "success");
      router.refresh();
      onClose();
    } else {
      setError(res.error);
      toast(res.error, "error");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-project-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          if (!pending) onClose();
        }}
        disabled={pending}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div className="sk-pop-center relative w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2
          id="edit-project-title"
          className="font-display text-xl text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Edit project
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Tweak the title or update who the room is for.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <Label htmlFor="edit-project-title-input">Project title</Label>
            <Input
              id="edit-project-title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              maxLength={120}
              disabled={pending}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="edit-artist-name">Artist name</Label>
            <Input
              id="edit-artist-name"
              type="text"
              value={artistName}
              onChange={(e) => {
                setArtistName(e.target.value);
              }}
              maxLength={80}
              disabled={pending}
            />
          </div>
          <div>
            <Label htmlFor="edit-artist-email">Artist email</Label>
            <Input
              id="edit-artist-email"
              type="email"
              value={artistEmail}
              onChange={(e) => {
                setArtistEmail(e.target.value);
              }}
              disabled={pending}
            />
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2"
          >
            <p className="text-sm text-[rgb(var(--fg-danger))]">{error}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void onSave();
            }}
            disabled={!dirty || !valid || pending}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
