"use client";

import { ExternalLink, FileText, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, ClockIcon, DocIcon } from "~/components/artist/funnel/funnel-icons";
import {
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
  SecondaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useQueueVersionRefresh } from "~/components/runtime-state/queue-version-refresh";
import { withArtistStudio } from "~/lib/artist-studio-context";
import {
  cancelPaymentProofUploadAction,
  presignProofUploadAction,
  submitPaymentProofAction,
  type ProofContentType,
} from "./actions";
import { formatPurchaseMoney, type ProofStatus, proofStatusCopy } from "./pay-data";
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

export function parseProofAmountCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function amountInputValue(cents: number): string {
  const value = cents / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

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
  if (type === "" || type === "application/octet-stream") {
    const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "heic") return "image/heic";
    if (extension === "pdf") return "application/pdf";
  }
  return null;
}

export function proofFileError(file: File): string | null {
  if (!proofContentType(file)) return "Choose a JPG, PNG, WebP, HEIC, or PDF file.";
  if (file.size <= 0) return "That file is empty. Choose another one.";
  if (file.size > 15 * 1024 * 1024) return "That file is over 15 MB. Choose a smaller one.";
  return null;
}

function statusChip(status: ProofStatus): { label: string; className: string } {
  if (status === "paid") {
    return {
      label: "Confirmed",
      className: "bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rejected",
      className: "bg-[rgb(var(--fg-danger)/0.1)] text-[rgb(var(--fg-danger-text))]",
    };
  }
  return {
    label: "In review",
    className: "bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-text))]",
  };
}

function formatUploadedAt(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function UploadProofScreen({
  productName,
  studioId,
  producerName,
  purchaseId,
  installmentId,
  installmentPosition,
  proofs,
  paidCents,
  totalCents,
  thisProofCents,
  currency,
  proofUploadsAvailable = true,
  bookingHref,
  status: initialStatus = "empty",
  rejectionNote,
  proofStateVersion,
  previewOnly = false,
  onPreviewSubmit,
}: {
  productName: string;
  studioId?: string | undefined;
  producerName: string;
  purchaseId?: string | undefined;
  installmentId?: string | undefined;
  installmentPosition?: number | undefined;
  proofs: readonly ArtistProofHistoryItem[];
  paidCents: number;
  totalCents: number;
  thisProofCents: number;
  currency?: string | undefined;
  proofUploadsAvailable?: boolean | undefined;
  bookingHref?: string | undefined;
  status?: ProofStatus;
  rejectionNote?: string | undefined;
  proofStateVersion?: string | undefined;
  /** Development gallery only: exercises UI without mutating storage. */
  previewOnly?: boolean | undefined;
  /** Development gallery only: advances a mocked end-to-end review flow. */
  onPreviewSubmit?: ((submission: PreviewProofSubmission) => void) | undefined;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const effectiveCurrency = currency ?? "ILS";
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ProofStatus>(initialStatus);
  const [amount, setAmount] = useState(() => amountInputValue(thisProofCents));
  const [note, setNote] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const proofStateEndpoint =
    purchaseId && installmentId
      ? `/api/runtime/queue-version?kind=artist-payment-proof&purchaseId=${encodeURIComponent(
          purchaseId,
        )}&installmentId=${encodeURIComponent(installmentId)}`
      : null;

  useQueueVersionRefresh({
    enabled: status === "awaiting" && !previewOnly && online,
    endpoint: proofStateEndpoint,
    initialVersion: proofStateVersion ?? null,
    intervalMs: 8_000,
    refreshOnVisibilityChange: true,
  });

  function clearPreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
  }

  function clearFile() {
    setFile(null);
    clearPreview();
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    setStatus(initialStatus);
    setAmount(amountInputValue(thisProofCents));
    if (["empty", "awaiting", "rejected", "paid"].includes(initialStatus)) clearFile();
  }, [initialStatus, thisProofCents]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const amountCents = parseProofAmountCents(amount);
  const amountError =
    amount.length === 0
      ? "Enter the amount shown on this proof."
      : amountCents === null
        ? "Enter a valid amount with up to two decimal places."
        : amountCents > thisProofCents
          ? `Amount cannot exceed ${formatPurchaseMoney(thisProofCents, effectiveCurrency)}.`
          : null;
  const isUploading = status === "uploading";
  const isSubmitting = status === "submitting";
  const isBusy = isUploading || isSubmitting;
  const isAwaiting = status === "awaiting";
  const isRejected = status === "rejected";
  const isPaidInFull = status === "paid" || paidCents >= totalCents;
  const canUpload = proofUploadsAvailable && !isAwaiting && !isPaidInFull;
  const canSend = Boolean(file && !amountError && !isBusy && canUpload && (online || previewOnly));
  const paidPct = totalCents <= 0 ? 100 : Math.min(100, Math.round((paidCents / totalCents) * 100));
  const headline = proofStatusCopy(status, producerName);

  function pickFile() {
    if (!canUpload || isBusy) return;
    if (fileRef.current) fileRef.current.value = "";
    fileRef.current?.click();
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) return;
    const error = proofFileError(picked);
    if (error) {
      setUploadError(error);
      event.target.value = "";
      return;
    }
    clearPreview();
    setUploadError(null);
    setFile(picked);
    const type = proofContentType(picked);
    if (type?.startsWith("image/") && type !== "image/heic") {
      const url = URL.createObjectURL(picked);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
    setStatus("attached");
  }

  function send() {
    if (!online && !previewOnly) {
      setUploadError("Reconnect before uploading. No proof has been sent.");
      return;
    }
    if (!file || !canSend || amountCents === null) return;
    const contentType = proofContentType(file);
    const fileError = proofFileError(file);
    if (!contentType || fileError) {
      setUploadError(fileError ?? "Choose another file and try again.");
      return;
    }
    if (previewOnly) {
      onPreviewSubmit?.({
        amountCents,
        note: note.trim() || null,
        originalFileName: file.name,
        contentType,
        sizeBytes: file.size,
      });
      setStatus("awaiting");
      clearFile();
      return;
    }
    if (!purchaseId || !installmentId) {
      setUploadError("This payment link is incomplete. Return to Payment and try again.");
      return;
    }
    const submittedFile = file;
    const submittedNote = note.trim() || null;
    try {
      startManagedPaymentProofUpload({
        file: submittedFile,
        purchaseId,
        installmentId,
        contentType,
        amountCents,
        note: submittedNote,
        presign: presignProofUploadAction,
        cleanup: cancelPaymentProofUploadAction,
        submit: submitPaymentProofAction,
        uploadFile: uploadPaymentProofBytes,
        onStart: () => {
          if (!mountedRef.current) return;
          setStatus("uploading");
          setUploadError(null);
        },
        onSubmitting: () => {
          if (!mountedRef.current) return;
          setStatus("submitting");
        },
        onSuccess: () => {
          if (!mountedRef.current) return;
          clearFile();
          setNote("");
          setStatus("awaiting");
          router.refresh();
        },
        onCancelled: () => {
          if (!mountedRef.current) return;
          setStatus("attached");
          setUploadError("Upload stopped. The payment proof was not submitted.");
        },
        onFailure: (message) => {
          if (!mountedRef.current) return;
          setStatus("attached");
          setUploadError(message);
        },
      });
    } catch (error) {
      setStatus("attached");
      setUploadError(error instanceof Error ? error.message : "Could not upload the proof.");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[rgb(var(--bg-background))]">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-x-hidden">
        <FunnelTopBar
          title="Payment proof"
          sub={`INSTALLMENT ${String(installmentPosition ?? 1)}`}
          onBack={() => {
            router.back();
          }}
        />

        <main className="flex-1 px-4 pt-3 pb-40 min-[390px]:px-5">
          <h1 className="font-syne text-[24px] leading-tight font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            {isPaidInFull
              ? "All paid up"
              : isAwaiting
                ? "Proof sent"
                : isRejected
                  ? "Upload a replacement"
                  : "Show what you paid"}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {isAwaiting
              ? `${producerName} will review the exact amount and evidence you sent.`
              : `Upload a private bank or Bit receipt. Only you and ${producerName} can open it.`}
          </p>

          {isAwaiting && !isPaidInFull ? (
            <div
              role="status"
              className="mt-4 flex gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.3)] bg-[rgb(var(--brand-primary)/0.09)] p-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.16)] text-[rgb(var(--brand-primary-text))]">
                <ClockIcon width={17} height={17} />
              </span>
              <div>
                <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
                  Needs producer review
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
                  You can leave this screen. The proof stays private and immutable.
                </p>
              </div>
            </div>
          ) : null}

          {isRejected && !isPaidInFull ? (
            <div
              role="alert"
              className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.28)] bg-[rgb(var(--fg-danger)/0.07)] p-4"
            >
              <p className="text-sm font-bold text-[rgb(var(--fg-danger-text))]">Producer note</p>
              <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {rejectionNote ?? "Please upload a clearer replacement proof."}
              </p>
              <button
                type="button"
                onClick={pickFile}
                className="sk-press mt-3 min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger))] px-4 text-sm font-bold text-white"
              >
                Choose replacement <ArrowRight width={15} height={15} />
              </button>
            </div>
          ) : null}

          {isPaidInFull ? (
            <div
              role="status"
              className="mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.3)] bg-[rgb(var(--fg-success)/0.1)] p-4 text-sm font-bold text-[rgb(var(--fg-success-text))]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--fg-success-text))] text-[rgb(var(--fg-on-success))]">
                <Check width={16} height={16} />
              </span>
              Payment complete
            </div>
          ) : null}

          {canUpload ? (
            <section aria-labelledby="proof-details" className="mt-4 space-y-3">
              <h2 id="proof-details" className="sr-only">
                Proof details
              </h2>
              <div className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] p-4 text-white">
                <p className="truncate text-xs text-white/70">{productName}</p>
                <label
                  htmlFor="proof-amount"
                  className="mt-3 block font-mono text-[10px] font-bold tracking-widest text-white/55 uppercase"
                >
                  Amount this receipt shows
                </label>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-lg text-[rgb(var(--brand-primary))]">
                    {effectiveCurrency}
                  </span>
                  <input
                    id="proof-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                    }}
                    aria-describedby="proof-amount-help"
                    className="min-w-0 flex-1 border-0 border-b border-white/25 bg-transparent py-1 font-mono text-[28px] font-bold text-white outline-none focus:border-[rgb(var(--brand-primary))]"
                  />
                </div>
                <p
                  id="proof-amount-help"
                  className={`mt-1.5 text-xs ${amountError ? "text-[#ffb4a7]" : "text-white/55"}`}
                >
                  {amountError ??
                    `Up to ${formatPurchaseMoney(thisProofCents, effectiveCurrency)} remains on this installment.`}
                </p>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,.heic,application/pdf"
                onChange={onFileChange}
                disabled={isBusy}
                hidden
              />
              <button
                type="button"
                onClick={pickFile}
                disabled={isBusy}
                className="sk-press flex min-h-[148px] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 py-5 text-center disabled:opacity-60"
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Selected proof preview"
                    className="h-20 w-20 rounded-[var(--radius-md)] object-cover"
                  />
                ) : file ? (
                  <FileText
                    size={34}
                    aria-hidden
                    className="text-[rgb(var(--brand-primary-text))]"
                  />
                ) : (
                  <Upload size={32} aria-hidden className="text-[rgb(var(--brand-primary-text))]" />
                )}
                <span className="max-w-full truncate text-sm font-bold text-[rgb(var(--fg-default))]">
                  {file?.name ?? "Take a photo or choose a file"}
                </span>
                <span className="font-mono text-[10px] tracking-wide text-[rgb(var(--fg-muted))]">
                  JPG · PNG · WEBP · HEIC · PDF · MAX 15 MB
                </span>
              </button>

              <div>
                <label
                  htmlFor="proof-note"
                  className="text-sm font-bold text-[rgb(var(--fg-default))]"
                >
                  Note to {producerName}{" "}
                  <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                </label>
                <textarea
                  id="proof-note"
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                  placeholder="For example: Bit transfer sent in two parts."
                  className="mt-2 w-full resize-y rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5 text-base text-[rgb(var(--fg-default))] outline-none focus:ring-2 focus:ring-[rgb(var(--focus-ring))]"
                />
              </div>
              <p
                role="status"
                aria-live="polite"
                className="text-center text-xs text-[rgb(var(--fg-muted))]"
              >
                {headline.headline}
              </p>
              {uploadError ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.08)] p-3 text-center text-xs font-medium text-[rgb(var(--fg-danger-text))]"
                >
                  {uploadError}
                </p>
              ) : null}
              {!online && !previewOnly ? (
                <p
                  role="status"
                  className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-3 text-center text-xs text-[rgb(var(--fg-secondary))]"
                >
                  Reconnect to upload this proof. The server has not received anything.
                </p>
              ) : null}
            </section>
          ) : !isAwaiting && !isPaidInFull && !isRejected ? (
            <p className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-sm text-[rgb(var(--fg-muted))]">
              This installment is not ready for another proof.
            </p>
          ) : null}

          {proofs.length > 0 ? (
            <section aria-labelledby="proof-history" className="mt-6">
              <h2 id="proof-history">
                <Eyebrow>
                  <DocIcon aria-hidden /> Proof history
                </Eyebrow>
              </h2>
              <ul className="mt-2 flex list-none flex-col gap-2">
                {proofs.map((proof) => {
                  const chip = statusChip(proof.status);
                  return (
                    <li
                      key={proof.id}
                      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-bold text-[rgb(var(--fg-default))]">
                            {formatPurchaseMoney(proof.amountCents, effectiveCurrency)}
                          </p>
                          <p
                            className="mt-1 truncate text-xs text-[rgb(var(--fg-muted))]"
                            title={proof.originalFileName}
                          >
                            {proof.originalFileName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[rgb(var(--fg-muted))]">
                            {formatUploadedAt(proof.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[9px] font-bold tracking-wider uppercase ${chip.className}`}
                        >
                          {chip.label}
                        </span>
                      </div>
                      {proof.rejectionNote ? (
                        <p className="mt-2 text-xs leading-relaxed whitespace-pre-wrap text-[rgb(var(--fg-danger-text))]">
                          {proof.rejectionNote}
                        </p>
                      ) : null}
                      <a
                        href={proof.evidenceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                        className="sk-press mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] text-xs font-bold text-[rgb(var(--brand-primary-text))]"
                      >
                        Open private evidence <ExternalLink size={13} aria-hidden />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section
            aria-label="Payment progress"
            className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
          >
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-mono font-bold tracking-wider text-[rgb(var(--fg-muted))] uppercase">
                Paid so far
              </span>
              <span className="font-mono font-bold text-[rgb(var(--fg-default))]">
                {formatPurchaseMoney(paidCents, effectiveCurrency)} of{" "}
                {formatPurchaseMoney(totalCents, effectiveCurrency)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={paidPct}
              aria-valuetext={`${formatPurchaseMoney(paidCents, effectiveCurrency)} paid of ${formatPurchaseMoney(totalCents, effectiveCurrency)}`}
              className="mt-2 h-2 overflow-hidden rounded-full bg-[rgb(var(--bg-sunken))]"
            >
              <div
                className="h-full rounded-full bg-[rgb(var(--brand-primary))] transition-[width] motion-reduce:transition-none"
                style={{ width: `${String(paidPct)}%` }}
              />
            </div>
          </section>
        </main>

        <div
          className="sticky bottom-0 z-10 px-4 pt-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] min-[390px]:px-5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background)/0), rgb(var(--bg-background)) 24%)",
          }}
        >
          {canUpload ? (
            <PrimaryCta
              onClick={send}
              disabled={!canSend}
              glow={canSend}
              ariaBusy={isBusy}
              sub={
                !online && !previewOnly
                  ? "Reconnect to send this live proof"
                  : file
                    ? `Sends privately to ${producerName}`
                    : "Attach a file to continue"
              }
            >
              {isBusy ? (
                isSubmitting ? (
                  "Sending…"
                ) : (
                  "Uploading…"
                )
              ) : (
                <>
                  Send proof <ArrowRight />
                </>
              )}
            </PrimaryCta>
          ) : bookingHref ? (
            <PrimaryCta
              onClick={() => {
                if (!online) return;
                router.push(bookingHref);
              }}
              disabled={!online}
              glow={false}
            >
              {online ? "Book a session" : "Reconnect to book"} <ArrowRight />
            </PrimaryCta>
          ) : (
            <SecondaryCta
              onClick={() => {
                router.push(withArtistStudio("/artist", studioId));
              }}
            >
              Back to Home
            </SecondaryCta>
          )}
        </div>
      </div>
    </div>
  );
}
