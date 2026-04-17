"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, Label, Textarea, Select } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { cancelContract, createTemplate, sendContract } from "./actions";

interface Template {
  id: string;
  name: string;
  body: string;
  active: boolean;
  updatedAt: Date;
}
interface ContractRow {
  id: string;
  title: string;
  artistName: string;
  artistEmail: string;
  status: "draft" | "sent" | "viewed" | "signed" | "expired" | "cancelled";
  createdAt: Date;
  signedAt: Date | null;
}

const STATUS_BADGE: Record<
  ContractRow["status"],
  { variant: "neutral" | "active" | "warning" | "danger" | "accent"; label: string }
> = {
  draft: { variant: "neutral", label: "Draft" },
  sent: { variant: "warning", label: "Sent" },
  viewed: { variant: "accent", label: "Viewed" },
  signed: { variant: "active", label: "Signed" },
  expired: { variant: "danger", label: "Expired" },
  cancelled: { variant: "danger", label: "Cancelled" },
};

const DEFAULT_TEMPLATE_BODY = `# Master Agreement

Between **{{producerName}}** (the "Producer") and **{{artistName}}** (the "Artist").

## Scope of Work
Producer agrees to deliver services for the "{{packageName}}" package on {{sessionDate}} ({{sessionDurationMin}} min).

## Deliverables
Producer shall deliver final mixes and stems upon receipt of the full invoice amount. Final files remain securely locked until the balance is cleared.

## Publishing
Artist retains 50% of publishing rights.

## Signatures
Artist: {{artistName}}
Email: {{artistEmail}}

By signing below, the Artist agrees to the terms above.
`;

const DEFAULT_TITLE = "Master Agreement";

export function ContractsClient({
  templates,
  contracts,
  siteUrl,
}: {
  templates: Template[];
  contracts: ContractRow[];
  siteUrl: string;
}) {
  const [issued, setIssued] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      {issued ? (
        <IssuedBanner
          url={issued}
          onDismiss={() => {
            setIssued(null);
          }}
        />
      ) : null}

      <section>
        <h2 className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Send a contract
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Pick a template, enter the artist, and hit Send. The artist gets a private URL to
          review + sign.
        </p>
        <div className="mt-4">
          <SendContractForm
            templates={templates.filter((t) => t.active)}
            siteUrl={siteUrl}
            onIssued={(url) => {
              setIssued(url);
            }}
          />
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Templates
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Markdown with <code className="font-mono">{"{{placeholders}}"}</code> like{" "}
          <code className="font-mono">{"{{artistName}}"}</code>,{" "}
          <code className="font-mono">{"{{sessionDate}}"}</code>,{" "}
          <code className="font-mono">{"{{packageName}}"}</code>.
        </p>
        <div className="mt-4">
          <TemplatesPanel templates={templates} />
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          Sent contracts
        </h2>
        <div className="mt-4">
          <ContractsList items={contracts} />
        </div>
      </section>
    </div>
  );
}

function IssuedBanner({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast("Contract URL copied.", "success");
    } catch {
      toast("Copy failed — select the URL manually.", "error");
    }
  }
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.07)] p-4 reveal-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))] pulse-green" />
            Contract ready to send
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
            Copy this signing URL now — the token is one-shot. Send it to the artist.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 font-mono text-xs text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="flex-1 truncate rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 font-mono text-xs text-[rgb(var(--fg-primary))]">
          {url}
        </code>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void copy();
          }}
          className="shrink-0"
        >
          {copied ? "✓ Copied" : "Copy URL"}
        </Button>
      </div>
    </div>
  );
}

function SendContractForm({
  templates,
  siteUrl,
  onIssued,
}: {
  templates: Template[];
  siteUrl: string;
  onIssued: (url: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [artistName, setArtistName] = useState("");
  const [artistEmail, setArtistEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (templates.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-10 text-center">
        <p className="font-display text-lg" style={{ fontWeight: 700 }}>
          No templates yet.
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Create a template below first — Master Agreement is a good starting point.
        </p>
      </div>
    );
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!templateId) {
      setError("pick a template");
      return;
    }
    startTransition(async () => {
      const res = await sendContract({
        templateId,
        title: title.trim() || DEFAULT_TITLE,
        artistName: artistName.trim(),
        artistEmail: artistEmail.trim(),
      });
      if (res.ok) {
        toast("Contract sent — copy the URL below.", "success");
        const url = `${siteUrl.replace(/\/$/, "")}/sign/${res.data.shareToken}`;
        onIssued(url);
        setArtistName("");
        setArtistEmail("");
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sendTemplate">Template</Label>
          <Select
            id="sendTemplate"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sendTitle">Contract title</Label>
          <Input
            id="sendTitle"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="sendArtistName">Artist name</Label>
          <Input
            id="sendArtistName"
            type="text"
            value={artistName}
            onChange={(e) => {
              setArtistName(e.target.value);
            }}
            required
            maxLength={120}
          />
        </div>
        <div>
          <Label htmlFor="sendArtistEmail">Artist email</Label>
          <Input
            id="sendArtistEmail"
            type="email"
            value={artistEmail}
            onChange={(e) => {
              setArtistEmail(e.target.value);
            }}
            required
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}
      <div className="mt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send contract"}
        </Button>
      </div>
    </form>
  );
}

function TemplatesPanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [body, setBody] = useState(DEFAULT_TEMPLATE_BODY);

  function onCreate(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createTemplate({ name: name.trim(), body });
      if (res.ok) {
        toast(`"${name.trim()}" template created.`, "success");
        setOpen(false);
        setName("");
        setBody(DEFAULT_TEMPLATE_BODY);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  return (
    <div className="space-y-3">
      {templates.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-10 text-center">
          <p className="font-display text-lg" style={{ fontWeight: 700 }}>
            Start with a Master Agreement.
          </p>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            We pre-filled the body — edit before creating.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => {
                setOpen(true);
              }}
            >
              + Create first template
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
            >
              <div className="min-w-0">
                <p className="font-display text-lg" style={{ fontWeight: 700 }}>
                  {t.name}
                </p>
                <p className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-muted))]">
                  {t.body.length} chars · updated{" "}
                  {new Date(t.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                </p>
              </div>
              {!t.active ? <Badge>Archived</Badge> : null}
            </li>
          ))}
        </ul>
      )}

      {!open && templates.length > 0 ? (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          + New template
        </Button>
      ) : null}

      {open ? (
        <form
          onSubmit={onCreate}
          className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
        >
          <div className="grid gap-4">
            <div>
              <Label htmlFor="tname">Template name</Label>
              <Input
                id="tname"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="Master Agreement"
                required
                maxLength={120}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="tbody">Body (markdown)</Label>
              <Textarea
                id="tbody"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                }}
                className="min-h-[280px] font-mono text-sm"
                required
              />
              <p className="mt-1.5 font-mono text-xs text-[rgb(var(--fg-muted))]">
                Placeholders:{" "}
                <span className="text-[rgb(var(--fg-secondary))]">
                  {`{{artistName}} {{artistEmail}} {{producerName}} {{packageName}} {{sessionDate}} {{sessionDurationMin}}`}
                </span>
              </p>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save template"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ContractsList({ items }: { items: ContractRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  function onCancel(id: string) {
    startTransition(async () => {
      const res = await cancelContract({ id });
      if (res.ok) {
        toast("Contract cancelled.", "info");
        setConfirming(null);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-10 text-center">
        <p className="font-display text-lg" style={{ fontWeight: 700 }}>
          No contracts sent yet.
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Send your first using the form above.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-2">
      {items.map((c) => {
        const badge = STATUS_BADGE[c.status];
        return (
          <li
            key={c.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
          >
            <div className="min-w-0">
              <p className="font-display text-lg" style={{ fontWeight: 700 }}>
                {c.title}
              </p>
              <p className="mt-0.5 text-sm text-[rgb(var(--fg-secondary))]">
                {c.artistName}{" "}
                <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">{c.artistEmail}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-[rgb(var(--fg-muted))]">
                Sent {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {c.signedAt
                  ? ` · signed ${new Date(c.signedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={badge.variant} dot>
                {badge.label}
              </Badge>
              {c.status !== "signed" && c.status !== "cancelled" ? (
                confirming === c.id ? (
                  <>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        onCancel(c.id);
                      }}
                      disabled={pending}
                    >
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirming(null);
                      }}
                      disabled={pending}
                    >
                      Back
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirming(c.id);
                    }}
                  >
                    Cancel
                  </Button>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
