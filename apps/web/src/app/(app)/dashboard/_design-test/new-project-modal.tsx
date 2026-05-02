/* eslint-disable @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — New Project modal. Drop-in replacement for the
// previous "navigate to /dashboard/projects/new" jump that landed the
// producer on the old (Tailwind) form mid-design-test surface.
//
// Form fields mirror project.create's CreateProjectInput: title,
// artistName, artistEmail. On submit, dispatches the createProject
// Server Action; on success, navigates into the new project room.

import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "./primitives";
import { createProject } from "./project-actions";
import { validateNewProjectInput } from "./create-validators";

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

export function NewProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setArtistName("");
    setArtistEmail("");
    setError(null);
    const t = window.setTimeout(() => titleRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  const submit = () => {
    const input = { title, artistName, artistEmail };
    const localError = validateNewProjectInput(input);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    startTransition(() => {
      void (async () => {
        const result = await createProject(input);
        if (result.ok) {
          router.push(`/dashboard/projects/${result.id}`);
        } else {
          setError(result.error);
        }
      })();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
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
              Workspace
            </span>
            <h2
              id="new-project-title"
              className="font-syne"
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                margin: 0,
                lineHeight: 1.05,
              }}
            >
              New project
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

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="label-tiny">Project title</span>
            <input
              ref={titleRef}
              style={inputCss}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunset Sessions Vol. 2"
              maxLength={120}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="label-tiny">Artist or client name</span>
            <input
              style={inputCss}
              value={artistName}
              onChange={(e) => setArtistName(e.target.value)}
              placeholder="Lena Cruz"
              maxLength={80}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="label-tiny">Artist or client email</span>
            <input
              style={inputCss}
              type="email"
              value={artistEmail}
              onChange={(e) => setArtistEmail(e.target.value)}
              placeholder="lena@example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) submit();
              }}
            />
          </label>
        </div>

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
            disabled={pending}
            className="sk-pop"
            style={{
              all: "unset",
              cursor: pending ? "not-allowed" : "pointer",
              padding: "9px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              background: "rgb(var(--brand-primary))",
              color: "#111009",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
