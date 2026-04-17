"use client";

import { useState, type SyntheticEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label, Select, Textarea } from "~/components/ui/input";
import { cn } from "~/lib/cn";
import {
  FIELD_LABELS,
  type FieldLike,
} from "~/lib/contracts/editor-helpers";
import {
  addContractRecipient,
  removeContractRecipient,
} from "~/app/(app)/dashboard/contracts/actions";

// Right-rail inspector. Renders ONLY when a field is selected; parent
// shows an empty-state otherwise. Updates call onChange with a full
// replacement field rather than a patch — keeps the wire protocol to
// the parent dead simple and plays nicely with React's functional
// setState pattern there.

export interface InspectorRecipient {
  id: string;
  name: string;
  email: string;
}

interface FieldInspectorProps {
  contractId: string;
  field: FieldLike | null;
  recipients: InspectorRecipient[];
  onChange: (updater: (f: FieldLike) => FieldLike) => void;
  onDelete: () => void;
  onRecipientsChanged: () => void;
  siteUrl: string;
}

export function FieldInspector({
  contractId,
  field,
  recipients,
  onChange,
  onDelete,
  onRecipientsChanged,
  siteUrl,
}: FieldInspectorProps) {
  const [managing, setManaging] = useState(false);

  return (
    <aside
      aria-label="Field inspector"
      className="flex w-full shrink-0 flex-col gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 md:w-[320px]"
    >
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        Inspector
      </p>

      {field === null ? (
        <p className="text-sm text-[rgb(var(--fg-muted))]">
          Select a field on the page to edit its properties — or pick a field
          type from the palette and click a page to place one.
        </p>
      ) : (
        <FieldEditor
          field={field}
          recipients={recipients}
          onChange={onChange}
          onDelete={onDelete}
          onManage={() => {
            setManaging(true);
          }}
        />
      )}

      {managing ? (
        <RecipientManager
          contractId={contractId}
          recipients={recipients}
          siteUrl={siteUrl}
          onClose={() => {
            setManaging(false);
          }}
          onChanged={onRecipientsChanged}
        />
      ) : null}
    </aside>
  );
}

function FieldEditor({
  field,
  recipients,
  onChange,
  onDelete,
  onManage,
}: {
  field: FieldLike;
  recipients: InspectorRecipient[];
  onChange: (updater: (f: FieldLike) => FieldLike) => void;
  onDelete: () => void;
  onManage: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-lg text-[rgb(var(--fg-primary))]">
          {FIELD_LABELS[field.type]}
        </p>
        <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
          Page {String(field.page)} · {field.w.toFixed(0)}% × {field.h.toFixed(0)}%
        </p>
      </div>

      <div>
        <Label htmlFor="inspector-assignee">Assignee</Label>
        <Select
          id="inspector-assignee"
          value={field.recipientId ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            onChange((f) => ({ ...f, recipientId: v }));
          }}
        >
          <option value="">Sender (I&apos;ll prefill)</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.email}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={onManage}
          className="mt-2 font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--brand-primary))] hover:underline"
        >
          Manage signers…
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-[rgb(var(--fg-primary))]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
          checked={field.required}
          onChange={(e) => {
            const v = e.target.checked;
            onChange((f) => ({ ...f, required: v }));
          }}
        />
        Required
      </label>

      {field.recipientId === null ? (
        <div>
          <Label htmlFor="inspector-prefill">Prefilled value</Label>
          <Textarea
            id="inspector-prefill"
            value={field.prefilledValue ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              onChange((f) => ({ ...f, prefilledValue: v }));
            }}
            placeholder="Text rendered into the PDF at send time"
            maxLength={2000}
          />
        </div>
      ) : null}

      {field.type === "dropdown" ? <DropdownChoices field={field} onChange={onChange} /> : null}
      {field.type === "number" ? <NumberBounds field={field} onChange={onChange} /> : null}
      {field.type === "date" ? <DateDefault field={field} onChange={onChange} /> : null}

      <div className="pt-2">
        <Button type="button" variant="destructive" onClick={onDelete}>
          Delete field
        </Button>
      </div>
    </div>
  );
}

function DropdownChoices({
  field,
  onChange,
}: {
  field: FieldLike;
  onChange: (updater: (f: FieldLike) => FieldLike) => void;
}) {
  const raw = field.options as { choices?: string[] } | null;
  const value = (raw?.choices ?? []).join(", ");
  return (
    <div>
      <Label htmlFor="inspector-choices">Choices (comma-separated)</Label>
      <Input
        id="inspector-choices"
        value={value}
        onChange={(e) => {
          const choices = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange((f) => ({ ...f, options: { ...(f.options ?? {}), choices } }));
        }}
        placeholder="Yes, No, Maybe"
      />
    </div>
  );
}

function NumberBounds({
  field,
  onChange,
}: {
  field: FieldLike;
  onChange: (updater: (f: FieldLike) => FieldLike) => void;
}) {
  const opts = field.options as { min?: number; max?: number } | null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label htmlFor="inspector-min">Min</Label>
        <Input
          id="inspector-min"
          type="number"
          value={opts?.min ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : Number(e.target.value);
            onChange((f) => ({
              ...f,
              options: { ...(f.options ?? {}), min: v },
            }));
          }}
        />
      </div>
      <div>
        <Label htmlFor="inspector-max">Max</Label>
        <Input
          id="inspector-max"
          type="number"
          value={opts?.max ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? undefined : Number(e.target.value);
            onChange((f) => ({
              ...f,
              options: { ...(f.options ?? {}), max: v },
            }));
          }}
        />
      </div>
    </div>
  );
}

function DateDefault({
  field,
  onChange,
}: {
  field: FieldLike;
  onChange: (updater: (f: FieldLike) => FieldLike) => void;
}) {
  const opts = field.options as { defaultToday?: boolean } | null;
  return (
    <label className="flex items-center gap-2 text-sm text-[rgb(var(--fg-primary))]">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
        checked={opts?.defaultToday ?? false}
        onChange={(e) => {
          const v = e.target.checked;
          onChange((f) => ({
            ...f,
            options: { ...(f.options ?? {}), defaultToday: v },
          }));
        }}
      />
      Default to today when signed
    </label>
  );
}

// ─── Recipient manager (modal) ──────────────────────────────────────
// Add + list + remove signers. Signing URL is shown ONCE on add, same
// one-shot discipline as project share URLs: producer copies it, we
// only keep sha256(token). Copy-to-clipboard ideal-path, textarea
// fallback for clipboard-denied contexts (e.g. cross-origin iframes).

function RecipientManager({
  contractId,
  recipients,
  siteUrl,
  onClose,
  onChanged,
}: {
  contractId: string;
  recipients: InspectorRecipient[];
  siteUrl: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    void (async () => {
      const res = await addContractRecipient({
        contractId,
        name: name.trim(),
        email: email.trim(),
      });
      setPending(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const base = siteUrl.replace(/\/$/, "");
      setIssuedUrl(`${base}/sign/${res.data.signingToken}`);
      setName("");
      setEmail("");
      onChanged();
    })();
  }

  async function remove(id: string) {
    setError(null);
    const res = await removeContractRecipient({ id, contractId });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage signers"
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(0_0_0_/_0.6)] p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 shadow-2xl",
        )}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-lg">Signers</p>
            <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
              Each signer gets a unique signing link.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="font-mono text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
          >
            ✕
          </button>
        </div>

        {recipients.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {recipients.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-[rgb(var(--fg-primary))]">{r.name}</p>
                  <p className="truncate font-mono text-xs text-[rgb(var(--fg-muted))]">
                    {r.email}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    void remove(r.id);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {issuedUrl ? (
          <IssuedSigningBanner
            url={issuedUrl}
            onDismiss={() => {
              setIssuedUrl(null);
            }}
          />
        ) : null}

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="rec-name">Name</Label>
            <Input
              id="rec-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              maxLength={200}
              required
              placeholder="Alex Kim"
            />
          </div>
          <div>
            <Label htmlFor="rec-email">Email</Label>
            <Input
              id="rec-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
              placeholder="alex@example.com"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add signer"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IssuedSigningBanner({
  url,
  onDismiss,
}: {
  url: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // swallow — textarea is visible for manual select
    }
  }
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
          Signing link — one-shot
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
        Copy this now. After dismissing, we only keep a hash — you can&apos;t
        get it back.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-[0.68rem] text-[rgb(var(--fg-primary))]">
          {url}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void copy();
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
