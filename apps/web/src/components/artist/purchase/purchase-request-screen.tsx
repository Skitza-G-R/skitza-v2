"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { FunnelTopBar } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { requestToBookAction } from "./actions";
import { formatPurchaseMoney, type PurchaseTargetProject } from "./purchase-data";

export function PurchaseRequestScreen({
  productId,
  productName,
  producerName,
  studioId,
  amountCents,
  currency,
  songQty,
  targetProjects,
  previewSentHref,
  backHrefOverride,
}: {
  productId: string;
  productName: string;
  producerName: string;
  studioId: string;
  amountCents: number;
  currency: string;
  songQty?: number | undefined;
  targetProjects: readonly PurchaseTargetProject[];
  previewSentHref?: string | undefined;
  backHrefOverride?: string | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const operationKeyRef = useRef<string | null>(null);
  const [targetKind, setTargetKind] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetReady = targetKind === "new" || projectId !== null;

  async function submit() {
    if (sending || !online || !targetReady) return;
    setSending(true);
    setError(null);
    const operationKey = operationKeyRef.current ?? crypto.randomUUID();
    operationKeyRef.current = operationKey;
    if (previewSentHref) {
      operationKeyRef.current = null;
      router.push(previewSentHref);
      return;
    }
    const result = await requestToBookAction({
      productId,
      operationKey,
      ...(songQty ? { songQty } : {}),
      ...(targetKind === "existing" && projectId ? { projectId } : {}),
    });
    if (!result.ok) {
      setSending(false);
      setError(result.error);
      return;
    }
    operationKeyRef.current = null;
    router.push(
      withArtistStudio(
        `/artist/purchase/${encodeURIComponent(productId)}/sent?req=${encodeURIComponent(
          result.purchaseRequestId,
        )}`,
        studioId,
      ),
    );
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg-background))]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
        <FunnelTopBar
          title="Request to book"
          sub="NO PAYMENT YET"
          onBack={() => {
            router.push(
              backHrefOverride ?? withArtistStudio(`/artist/purchase/${productId}`, studioId),
            );
          }}
        />
        <main className="flex-1 px-4 pt-4 pb-32 min-[390px]:px-5">
          <section className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
            <h1 className="font-display text-[21px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              {productName}
            </h1>
            <p className="mt-1 font-mono text-[19px] font-bold text-[rgb(var(--fg-default))]">
              {formatPurchaseMoney(amountCents, currency)}
            </p>
            <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
              {producerName}
              {songQty ? ` · ${String(songQty)} ${songQty === 1 ? "song" : "songs"}` : ""}
            </p>
          </section>

          <fieldset className="mt-5">
            <legend className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
              Where should this work go?
            </legend>
            <div className="mt-3 space-y-2">
              <TargetChoice
                name="purchase-target"
                checked={targetKind === "new"}
                title="Start a new project"
                detail={`${producerName} will create it after you accept an approved request.`}
                onChange={() => {
                  setTargetKind("new");
                  setError(null);
                }}
              />
              {targetProjects.length > 0 ? (
                <TargetChoice
                  name="purchase-target"
                  checked={targetKind === "existing"}
                  title="Add to an existing project"
                  detail="Choose one of your active projects with this studio."
                  onChange={() => {
                    setTargetKind("existing");
                    setError(null);
                  }}
                />
              ) : null}
            </div>
          </fieldset>

          {targetKind === "existing" ? (
            <fieldset className="mt-4">
              <legend className="sr-only">Existing project</legend>
              <div className="space-y-2">
                {targetProjects.map((project) => (
                  <TargetChoice
                    key={project.id}
                    name="existing-project"
                    checked={projectId === project.id}
                    title={project.title}
                    detail={
                      project.lifecycleStatus === "active"
                        ? "Active project"
                        : "Waiting for payment"
                    }
                    onChange={() => {
                      setProjectId(project.id);
                      setError(null);
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}

          <p className="mt-5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Sending this request moves no money and accepts no agreement. The studio reviews it
            first.
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] p-3 text-[12px] text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
        </main>

        <div className="sticky bottom-0 px-4 pt-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5">
          <button
            type="button"
            onClick={() => {
              void submit();
            }}
            disabled={!online || !targetReady || sending}
            className="sk-press min-h-12 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-[14px] font-bold text-[rgb(var(--fg-onsidebar))] disabled:opacity-50"
          >
            {sending ? "Sending…" : online ? "Send request" : "Reconnect to continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TargetChoice({
  name,
  checked,
  title,
  detail,
  onChange,
}: {
  name: string;
  checked: boolean;
  title: string;
  detail: string;
  onChange: () => void;
}) {
  return (
    <label
      className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-3.5"
      style={{
        borderColor: checked ? "rgb(var(--focus-ring))" : "rgb(var(--border-control))",
      }}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand-primary))]"
      />
      <span>
        <span className="block text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {detail}
        </span>
      </span>
    </label>
  );
}
