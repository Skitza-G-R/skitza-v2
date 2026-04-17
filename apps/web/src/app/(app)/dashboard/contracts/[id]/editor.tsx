"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { Badge } from "~/components/ui/badge";
import { FieldPalette } from "~/components/contracts/field-palette";
import {
  FieldInspector,
  type InspectorRecipient,
} from "~/components/contracts/field-inspector";
import { PdfCanvas } from "~/components/contracts/pdf-canvas";
import {
  canSend,
  createFieldAt,
  type FieldLike,
  type FieldType,
} from "~/lib/contracts/editor-helpers";
import {
  cancelContract,
  saveContractFields,
  sendContract,
} from "~/app/(app)/dashboard/contracts/actions";

// 3-pane editor: palette (left) · canvas (center) · inspector (right).
//
// State ownership lives here: `fields` is the full in-memory field
// list, plus `selectedIndex` tracks which one (if any) the inspector
// is editing. Every mutation path (palette place, tile drag, tile
// resize, inspector patch, delete) funnels through setFields with a
// functional updater, then a debounced autosave fires saveContractFields
// 2 seconds after the last change. The router diffs by id so new
// fields get their id back on save and the list stays stable.
//
// Mobile: the 3-pane layout collapses to a "sign on desktop" message
// above a read-only viewer. Placing/dragging fields on a touch device
// is possible but fiddly; producers already sign contracts on their
// laptop/desktop.

interface Contract {
  id: string;
  title: string;
  status: string;
  pdfUrl: string;
}

interface Recipient extends InspectorRecipient {
  signedAt: Date | null;
}

interface EditorProps {
  contract: Contract;
  initialFields: FieldLike[];
  initialRecipients: Recipient[];
  siteUrl: string;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

export function ContractEditor({
  contract,
  initialFields,
  initialRecipients,
  siteUrl,
}: EditorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const isDraft = contract.status === "draft";

  const [fields, setFields] = useState<FieldLike[]>(initialFields);
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pendingPlaceType, setPendingPlaceType] = useState<FieldType | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Autosave: debounce 2s after the last mutation. A ref-based flag
  // tracks whether the most recent edit has already been flushed;
  // otherwise unmount could drop an edit silently.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);

  const flushSave = useCallback(async () => {
    if (!isDraft) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaveState({ kind: "saving" });
    const snapshot = fieldsRef.current;
    const res = await saveContractFields({
      contractId: contract.id,
      fields: snapshot.map((f) => {
        // Avoid emitting `id: undefined` into the wire payload — with
        // exactOptionalPropertyTypes the Server Action type distinguishes
        // an omitted id from an undefined one.
        const base = {
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          type: f.type,
          required: f.required,
          recipientId: f.recipientId,
          prefilledValue: f.prefilledValue,
          options: f.options,
        };
        return f.id ? { ...base, id: f.id } : base;
      }),
    });
    inFlightRef.current = false;
    if (!res.ok) {
      setSaveState({ kind: "error", message: res.error });
      return;
    }
    // Re-hydrate ids onto freshly-created fields without blowing away
    // any edits the user made while the save was in flight. We match
    // by position+geometry+type; imperfect but only fires for the
    // no-id rows (the ones the server just assigned an id to) and
    // geometry is unlikely to collide between simultaneous unsaved
    // fields.
    setFields((current) => {
      const byKey = new Map<string, string>();
      for (const f of res.data.fields) {
        byKey.set(
          `${String(f.page)}:${f.x.toFixed(2)}:${f.y.toFixed(2)}:${f.type}`,
          f.id,
        );
      }
      return current.map((f) => {
        if (f.id) return f;
        const key = `${String(f.page)}:${f.x.toFixed(2)}:${f.y.toFixed(2)}:${f.type}`;
        const matched = byKey.get(key);
        if (matched) return { ...f, id: matched };
        return f;
      });
    });
    dirtyRef.current = false;
    setSaveState({ kind: "saved", at: Date.now() });
  }, [contract.id, isDraft]);

  // Snapshot ref so flushSave reads the latest fields without
  // re-creating itself on every edit (which would thrash the timer).
  const fieldsRef = useRef(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const scheduleSave = useCallback(() => {
    if (!isDraft) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 2000);
  }, [flushSave, isDraft]);

  // Flush on unmount so we don't drop the tail edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirtyRef.current && !inFlightRef.current) {
        void flushSave();
      }
    };
  }, [flushSave]);

  const mutateField = useCallback(
    (index: number, updater: (f: FieldLike) => FieldLike) => {
      setFields((prev) => {
        const next = [...prev];
        const current = next[index];
        if (!current) return prev;
        next[index] = updater(current);
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const handleDelete = useCallback(
    (index: number) => {
      setFields((prev) => prev.filter((_, i) => i !== index));
      setSelectedIndex(null);
      scheduleSave();
    },
    [scheduleSave],
  );

  const handlePlace = useCallback(
    (args: { page: number; centerX: number; centerY: number }) => {
      if (!pendingPlaceType) return;
      const newField = createFieldAt({
        type: pendingPlaceType,
        page: args.page,
        centerX: args.centerX,
        centerY: args.centerY,
        // Default assignee: the first recipient if any, else sender.
        recipientId: recipients[0]?.id ?? null,
      });
      setFields((prev) => {
        const next = [...prev, newField];
        setSelectedIndex(next.length - 1);
        return next;
      });
      setPendingPlaceType(null);
      scheduleSave();
    },
    [pendingPlaceType, recipients, scheduleSave],
  );

  const recipientMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of recipients) m.set(r.id, r.name);
    return m;
  }, [recipients]);

  const sendable = useMemo(
    () =>
      canSend({
        recipients: recipients.map((r) => ({ id: r.id })),
        fields: fields.map((f) => ({
          recipientId: f.recipientId,
          required: f.required,
        })),
      }),
    [fields, recipients],
  );

  async function onSend(e: SyntheticEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!sendable || sending) return;
    // Flush pending edits first so the send call sees them.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (dirtyRef.current) await flushSave();
    setSending(true);
    const res = await sendContract({ contractId: contract.id });
    setSending(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Contract sent.", "success");
    router.push("/dashboard/contracts");
  }

  async function onCancel() {
    if (cancelling) return;
    setCancelling(true);
    const res = await cancelContract({ contractId: contract.id });
    setCancelling(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Contract cancelled.", "success");
    router.refresh();
  }

  const selectedField =
    selectedIndex !== null ? (fields[selectedIndex] ?? null) : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/dashboard/contracts"
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-primary))]"
          >
            ← All contracts
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1
              className="truncate font-display text-2xl leading-tight tracking-tight sm:text-3xl"
              style={{ fontWeight: 700 }}
            >
              {contract.title}
            </h1>
            <StatusBadge status={contract.status} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={saveState} isDraft={isDraft} />
          {isDraft ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void onCancel();
                }}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  void onSend(e);
                }}
                disabled={!sendable || sending}
                title={
                  sendable
                    ? undefined
                    : "Add at least one signer and assign a required field to each."
                }
              >
                {sending ? "Sending…" : "Send"}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* Desktop: 3-pane flex. Mobile: stacked, with a note that edit
          tooling is best on desktop. */}
      <div className="hidden md:flex gap-4">
        <FieldPalette
          pendingPlaceType={pendingPlaceType}
          onArm={setPendingPlaceType}
          disabled={!isDraft}
        />
        <div className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))]">
          <PdfCanvas
            pdfUrl={contract.pdfUrl}
            fields={fields}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onUpdate={mutateField}
            onDelete={handleDelete}
            recipientMap={recipientMap}
            readOnly={!isDraft}
            pendingPlaceType={pendingPlaceType}
            onPlace={handlePlace}
          />
        </div>
        <FieldInspector
          contractId={contract.id}
          field={selectedField}
          recipients={recipients.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
          }))}
          onChange={(updater) => {
            if (selectedIndex !== null) mutateField(selectedIndex, updater);
          }}
          onDelete={() => {
            if (selectedIndex !== null) handleDelete(selectedIndex);
          }}
          onRecipientsChanged={() => {
            router.refresh();
            // Optimistic: router.refresh re-runs the RSC with new
            // recipients; until it lands, we keep the current client
            // list in sync with whatever was added.
            setRecipients((prev) => prev);
          }}
          siteUrl={siteUrl}
        />
      </div>

      <div className="md:hidden">
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-sm text-[rgb(var(--fg-secondary))]">
          Sign on desktop for now — the PandaDoc-style editor needs a bigger
          canvas than a phone comfortably gives. The PDF below is read-only
          on mobile.
        </div>
        <div className="mt-4 overflow-x-auto rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))]">
          <PdfCanvas
            pdfUrl={contract.pdfUrl}
            fields={fields}
            selectedIndex={null}
            onSelect={() => undefined}
            onUpdate={() => undefined}
            onDelete={() => undefined}
            recipientMap={recipientMap}
            readOnly
            pendingPlaceType={null}
            onPlace={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "draft":
      return <Badge dot>Draft</Badge>;
    case "sent":
      return (
        <Badge variant="warning" dot>
          Sent
        </Badge>
      );
    case "viewed":
      return (
        <Badge variant="warning" dot>
          Viewed
        </Badge>
      );
    case "signed":
    case "completed":
      return (
        <Badge variant="active" dot>
          {status === "completed" ? "Completed" : "Signed"}
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="danger" dot>
          Cancelled
        </Badge>
      );
    default:
      return <Badge dot>{status}</Badge>;
  }
}

function SaveIndicator({
  state,
  isDraft,
}: {
  state: SaveState;
  isDraft: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
    }, 15_000);
    return () => {
      clearInterval(id);
    };
  }, [state.kind]);
  // read `tick` so the hook isn't dead; its only purpose is to force
  // re-render so the "Xs ago" label refreshes.
  void tick;

  if (!isDraft) return null;

  switch (state.kind) {
    case "idle":
      return (
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Ready
        </span>
      );
    case "saving":
      return (
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
          Saving…
        </span>
      );
    case "saved": {
      const secs = Math.max(0, Math.floor((Date.now() - state.at) / 1000));
      return (
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-success))]">
          Saved · {secs < 5 ? "just now" : `${String(secs)}s ago`}
        </span>
      );
    }
    case "error":
      return (
        <span
          title={state.message}
          className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-danger))]"
        >
          Save failed — will retry
        </span>
      );
  }
}
