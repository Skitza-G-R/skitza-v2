"use client";

import { FileText, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight } from "~/components/artist/funnel/funnel-icons";
import { FunnelTopBar, PrimaryCta } from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import {
  cancelPaymentProofUploadAction,
  presignProofUploadAction,
  submitPaymentProofAction,
  type ProofContentType,
} from "./actions";
import { formatPurchaseMoney, type ProofStatus } from "./pay-data";
import { startManagedPaymentProofUpload, uploadPaymentProofBytes } from "./proof-upload-lifecycle";

export type ArtistProofHistoryItem = Readonly<{
  id: string;
  amountCents: number;
  status: ProofStatus;
  evidenceUrl: string;
  originalFileName: string;
  createdAt: Date;
  rejectionNote: string | null;
}>;

export type PreviewProofSubmission = Readonly<{
  amountCents: number;
  note: string | null;
  originalFileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
}>;

function proofContentType(file: File): ProofContentType | null {
  const type = file.type.toLowerCase();
  if (type === "image/jpg") return "image/jpeg";
  if (
    type === "image/jpeg" ||
    type === "image/png" ||
    type === "image/webp" ||
    type === "image/heic" ||
    type === "application/pdf"
  ) {
    return type;
  }
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "pdf") return "application/pdf";
  return null;
}

export function proofFileError(file: File): string | null {
  if (!proofContentType(file)) return "Choose a JPG, PNG, WebP, HEIC, or PDF file.";
  if (file.size <= 0) return "That file is empty. Choose another one.";
  if (file.size > 15 * 1024 * 1024) return "That file is over 15 MB. Choose a smaller one.";
  return null;
}

export function UploadProofScreen({
  productName,
  studioId,
  producerName,
  purchaseId,
  installmentId,
  installmentPosition,
  proofs = [],
  paidCents = 0,
  totalCents = 0,
  thisProofCents,
  currency = "ILS",
  proofUploadsAvailable = true,
  rejectionNote,
  previewOnly = false,
  onPreviewSubmit,
  backHref,
}: {
  productName: string;
  studioId?: string | undefined;
  producerName: string;
  purchaseId?: string | undefined;
  installmentId?: string | undefined;
  installmentPosition?: number | undefined;
  proofs?: readonly ArtistProofHistoryItem[];
  paidCents?: number;
  totalCents?: number;
  thisProofCents: number;
  currency?: string | undefined;
  proofUploadsAvailable?: boolean | undefined;
  bookingHref?: string | undefined;
  status?: ProofStatus;
  rejectionNote?: string | undefined;
  proofStateVersion?: string | undefined;
  previewOnly?: boolean | undefined;
  onPreviewSubmit?: ((submission: PreviewProofSubmission) => void) | undefined;
  backHref?: string | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operationKeyRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = phase !== "idle";

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    if (!proofUploadsAvailable) return;
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    const fileError = proofFileError(selected);
    if (fileError) {
      setError(fileError);
      event.target.value = "";
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const contentType = proofContentType(selected);
    const nextPreview =
      contentType?.startsWith("image/") && contentType !== "image/heic"
        ? URL.createObjectURL(selected)
        : null;
    previewUrlRef.current = nextPreview;
    setPreviewUrl(nextPreview);
    setFile(selected);
    setError(null);
    operationKeyRef.current = proofOperationKey(selected, purchaseId, installmentId);
  }

  function send() {
    if (!file || busy || !proofUploadsAvailable) return;
    if (!online && !previewOnly) {
      setError("Reconnect before uploading. No proof has been sent.");
      return;
    }
    const contentType = proofContentType(file);
    const fileError = proofFileError(file);
    if (!contentType || fileError) {
      setError(fileError ?? "Choose another file.");
      return;
    }
    if (previewOnly) {
      onPreviewSubmit?.({
        amountCents: thisProofCents,
        note: null,
        originalFileName: file.name,
        contentType,
        sizeBytes: file.size,
      });
      return;
    }
    if (!purchaseId || !installmentId) {
      setError("This proof link is incomplete. Return to the payment summary.");
      return;
    }
    const operationKey = operationKeyRef.current ?? crypto.randomUUID();
    operationKeyRef.current = operationKey;
    try {
      startManagedPaymentProofUpload({
        file,
        purchaseId,
        installmentId,
        operationKey,
        contentType,
        amountCents: thisProofCents,
        note: null,
        presign: presignProofUploadAction,
        cleanup: cancelPaymentProofUploadAction,
        submit: submitPaymentProofAction,
        uploadFile: uploadPaymentProofBytes,
        onStart: () => {
          setPhase("uploading");
          setError(null);
        },
        onSubmitting: () => {
          setPhase("submitting");
        },
        onSuccess: (proofId) => {
          clearProofOperation(purchaseId, installmentId);
          router.push(
            withArtistStudio(`/artist/payments/${purchaseId}/proof/${proofId}`, studioId),
          );
        },
        onCancelled: () => {
          setPhase("idle");
          setError("Upload stopped. Your proof was not sent.");
        },
        onFailure: (message) => {
          setPhase("idle");
          setError(message);
        },
      });
    } catch {
      setPhase("idle");
      setError("Could not start the upload. Try again.");
    }
  }

  return (
    <div className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden bg-[rgb(var(--bg-background))]">
      <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col overflow-hidden">
        <FunnelTopBar
          title="Upload proof"
          sub={`INSTALLMENT ${String(installmentPosition ?? 1)}`}
          onBack={() => {
            router.push(
              backHref ??
                withArtistStudio(
                  purchaseId ? `/artist/payments/${purchaseId}/instructions` : "/artist",
                  studioId,
                ),
            );
          }}
        />
        <main className="sk-native-scroll min-h-0 flex-1 px-4 pt-4 pb-6 min-[390px]:px-5">
          <h1 className="font-display text-[24px] leading-tight font-bold tracking-[-0.03em] text-[rgb(var(--fg-default))]">
            {rejectionNote ? "Upload a clearer proof" : "Send payment proof"}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            Add one receipt for {productName}. Only you and {producerName} can open it.
          </p>
          {rejectionNote ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.25)] bg-[rgb(var(--fg-danger)/0.07)] p-4 text-[13px] text-[rgb(var(--fg-danger-text))]"
            >
              {rejectionNote}
            </p>
          ) : null}

          <section className="mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] p-4 text-white shadow-[0_18px_40px_-16px_rgb(17_16_9/0.45)]">
            <p className="truncate text-[12px] text-white/70">{productName}</p>
            <p className="mt-3 font-mono text-[9px] font-semibold tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase">
              Locked installment amount
            </p>
            <p className="font-amount mt-1 font-mono text-[34px] leading-none font-bold tracking-[-0.03em] text-white tabular-nums">
              {formatPurchaseMoney(thisProofCents, currency)}
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-white/55">
              This amount comes from your accepted installment and cannot be edited here.
            </p>
          </section>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf"
            onChange={selectFile}
            disabled={busy || !proofUploadsAvailable}
            hidden
          />
          <button
            type="button"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            disabled={busy || !proofUploadsAvailable}
            className="sk-press mt-4 flex min-h-[170px] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] p-5 disabled:opacity-60"
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Selected proof preview"
                className="h-24 w-24 rounded-[var(--radius-md)] object-cover"
              />
            ) : file ? (
              <FileText size={34} aria-hidden className="text-[rgb(var(--brand-primary-text))]" />
            ) : (
              <Upload size={34} aria-hidden className="text-[rgb(var(--brand-primary-text))]" />
            )}
            <span className="max-w-full truncate text-[13px] font-bold text-[rgb(var(--fg-default))]">
              {file?.name ?? "Take a photo or choose a file"}
            </span>
            <span className="font-mono text-[9px] tracking-[0.08em] text-[rgb(var(--fg-muted))]">
              JPG · PNG · WEBP · HEIC · PDF · MAX 15 MB
            </span>
          </button>

          {!proofUploadsAvailable ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-3 text-[12px] text-[rgb(var(--fg-secondary))]"
            >
              Private proof upload is temporarily unavailable.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] p-3 text-[12px] text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
          {proofs.length > 0 ? (
            <details className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
              <summary className="min-h-12 cursor-pointer px-4 py-3 text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
                Payment history · {String(proofs.length)}
              </summary>
              <div className="border-t border-[rgb(var(--border-subtle))] px-4 py-3">
                {totalCents > 0 ? (
                  <p className="text-[11.5px] text-[rgb(var(--fg-muted))]">
                    {formatPurchaseMoney(paidCents, currency)} producer verified of{" "}
                    {formatPurchaseMoney(totalCents, currency)}
                  </p>
                ) : null}
                <ul className="mt-2 list-none divide-y divide-[rgb(var(--border-subtle))]">
                  {[...proofs].reverse().map((proof) => (
                    <li key={proof.id}>
                      {purchaseId ? (
                        <Link
                          href={withArtistStudio(
                            `/artist/payments/${purchaseId}/proof/${proof.id}`,
                            studioId,
                          )}
                          className="flex min-h-11 items-center justify-between gap-3 py-2 text-[12px]"
                        >
                          <span className="truncate text-[rgb(var(--fg-default))]">
                            {proof.originalFileName}
                          </span>
                          <span className="shrink-0 text-[rgb(var(--fg-muted))]">
                            {proof.status === "paid"
                              ? "Verified"
                              : proof.status === "awaiting"
                                ? "Awaiting"
                                : "Rejected"}
                          </span>
                        </Link>
                      ) : (
                        <span className="flex min-h-11 items-center justify-between gap-3 py-2 text-[12px]">
                          <span className="truncate text-[rgb(var(--fg-default))]">
                            {proof.originalFileName}
                          </span>
                          <span className="shrink-0 text-[rgb(var(--fg-muted))]">
                            {proof.status === "paid"
                              ? "Verified"
                              : proof.status === "awaiting"
                                ? "Awaiting"
                                : "Rejected"}
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite">
            {phase === "uploading"
              ? "Uploading payment proof"
              : phase === "submitting"
                ? "Sending payment proof for review"
                : ""}
          </p>
        </main>

        <div
          className="z-10 shrink-0 px-4 pt-5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background)/0), rgb(var(--bg-background)) 24%)",
          }}
        >
          <PrimaryCta
            onClick={send}
            disabled={!file || busy || !proofUploadsAvailable || (!online && !previewOnly)}
            glow={Boolean(file && !busy && proofUploadsAvailable && (online || previewOnly))}
            ariaBusy={busy}
            sub={
              !proofUploadsAvailable
                ? "Private proof upload is temporarily unavailable"
                : !online && !previewOnly
                  ? "Reconnect to send this proof"
                  : file
                    ? `Sends privately to ${producerName}`
                    : "Attach a file to continue"
            }
          >
            {phase === "uploading" ? (
              "Uploading…"
            ) : phase === "submitting" ? (
              "Sending…"
            ) : (
              <>
                Send proof <ArrowRight />
              </>
            )}
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}

function proofOperationKey(
  file: File,
  purchaseId: string | undefined,
  installmentId: string | undefined,
): string {
  const key = proofOperationStorageKey(purchaseId, installmentId);
  const fingerprint = `${file.name}:${String(file.size)}:${String(file.lastModified)}:${file.type}`;
  if (key) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
        fingerprint?: string;
        operationKey?: string;
      } | null;
      if (
        stored?.fingerprint === fingerprint &&
        stored.operationKey &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          stored.operationKey,
        )
      ) {
        return stored.operationKey;
      }
    } catch {
      // A malformed browser-only retry hint is safe to replace.
    }
  }
  const operationKey = crypto.randomUUID();
  if (key) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ fingerprint, operationKey }));
    } catch {
      // Retry remains safe for this attempt even when browser storage is unavailable.
    }
  }
  return operationKey;
}

function clearProofOperation(
  purchaseId: string | undefined,
  installmentId: string | undefined,
): void {
  const key = proofOperationStorageKey(purchaseId, installmentId);
  if (key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // A stale browser-only retry hint cannot change server idempotency.
    }
  }
}

function proofOperationStorageKey(
  purchaseId: string | undefined,
  installmentId: string | undefined,
): string | null {
  if (!purchaseId || !installmentId) return null;
  return `skitza.proof-operation:${purchaseId}:${installmentId}`;
}
