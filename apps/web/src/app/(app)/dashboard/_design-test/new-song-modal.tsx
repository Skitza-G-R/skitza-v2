/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — New Song modal. Pairs with the music-library
// "+ Add Song" button. Asks for project + title, calls addTrack +
// addVersion via the createSong Server Action, navigates to the new
// song page where the producer can upload the audio.

import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./primitives";
import { createSong } from "./song-create-actions";
import { validateNewSongInput } from "./create-validators";

const inputCss: CSSProperties = {
  all: "unset",
  width: "100%",
  fontSize: 13,
  fontFamily: "inherit",
  color: "rgb(var(--fg-default))",
  padding: "10px 12px",
  border: "1px solid rgb(var(--border-subtle))",
  borderRadius: 8,
  background: "rgb(var(--bg-elevated))",
  boxSizing: "border-box",
};

export type ProjectChoice = { id: string; title: string; client: string };

export function NewSongModal({
  open,
  onClose,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  projects: ProjectChoice[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Reset only on open transition — see new-product-modal.tsx for the
  // useEffect-deps lesson. Including pending or onClose would refire
  // mid-submit and wipe the error message.
  useEffect(() => {
    if (!open) return;
    setProjectId(projects[0]?.id ?? "");
    setTitle("");
    setError(null);
    const t = window.setTimeout(() => titleRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, projects]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  const submit = () => {
    const input = { projectId, title };
    const localError = validateNewSongInput(input);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    startTransition(() => {
      void (async () => {
        const result = await createSong(input);
        if (result.ok) {
          router.push(`/dashboard/music/${result.versionId}`);
        } else {
          setError(result.error);
        }
      })();
    });
  };

  const noProjects = projects.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-song-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="sk-pop-center"
        style={{
          width: "100%",
          maxWidth: 460,
          background: "rgb(var(--bg-background))",
          border: "1px solid rgb(var(--border-subtle))",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="label-tiny" style={{ display: "block", marginBottom: 4 }}>
              Music
            </span>
            <h2
              id="new-song-title"
              className="font-syne"
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.05,
              }}
            >
              New song
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: 6,
              borderRadius: 8,
              color: "rgb(var(--fg-muted))",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {noProjects ? (
          <p style={{ margin: 0, fontSize: 13, color: "rgb(var(--fg-muted))" }}>
            You don&apos;t have any projects yet. Create a project first, then add
            songs to it.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="label-tiny">Project</span>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                style={{
                  ...inputCss,
                  cursor: "pointer",
                  appearance: "menulist",
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.client ? ` — ${p.client}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span className="label-tiny">Song title</span>
              <input
                ref={titleRef}
                style={inputCss}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sunset Drive"
                maxLength={120}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !pending) submit();
                }}
              />
            </label>
            <p style={{ margin: 0, fontSize: 11, color: "rgb(var(--fg-muted))" }}>
              We&apos;ll create a v1 placeholder. Upload the audio on the song page.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: "rgb(var(--fg-danger))" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: "9px 14px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: "rgb(var(--fg-muted))",
              border: "1px solid rgb(var(--border-subtle))",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || noProjects}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending || noProjects ? "not-allowed" : "pointer",
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              opacity: pending || noProjects ? 0.6 : 1,
            }}
          >
            {pending ? "Creating…" : "Create song"}
          </button>
        </div>
      </div>
    </div>
  );
}
