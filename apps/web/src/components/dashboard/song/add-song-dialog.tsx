"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Copy, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  claimSongSpaceAction,
  createNoChargeSongProposalAction,
} from "~/app/(producer)/dashboard/clients-projects/actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { projectSongUploadHref } from "~/lib/clients/project-song-upload-href";
import { PUBLIC_BRAND_ORIGIN } from "~/lib/share/public-url";

export interface PaidExtraProductOption {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

export function paidExtraArtistPath(productId: string): string {
  return `/artist/purchase/${encodeURIComponent(productId)}`;
}

export function buildPaidExtraArtistMessage(input: {
  productId: string;
  productName: string;
  projectTitle: string;
}): string {
  const url = `${PUBLIC_BRAND_ORIGIN}${paidExtraArtistPath(input.productId)}`;
  return [
    `Paid extra song for “${input.projectTitle}”`,
    "",
    `Open “${input.productName}” in Skitza: ${url}`,
    "",
    `Sign in, choose one song, select “Add to an existing project”, then choose the exact project “${input.projectTitle}”.`,
    "The song space appears only after you accept the exact agreement and the complete first installment is confirmed.",
  ].join("\n");
}

export function noChargeProposalArtistPath(proposalToken: string): string {
  return `/artist/music/no-charge/${encodeURIComponent(proposalToken)}`;
}

export function buildNoChargeProposalMessage(input: {
  proposalToken: string;
  projectTitle: string;
  songTitle: string;
}): string {
  const url = `${PUBLIC_BRAND_ORIGIN}${noChargeProposalArtistPath(input.proposalToken)}`;
  return [
    `No charge song proposal for “${input.projectTitle}”`,
    "",
    `Song: “${input.songTitle}”`,
    `Review the exact ₪0 agreement in Skitza: ${url}`,
    "",
    "Sign in with the matching artist account connected to this project. The song space is created only after the artist accepts the exact agreement.",
  ].join("\n");
}

function formatPaidExtraProduct(product: PaidExtraProductOption): string {
  let price: string;
  try {
    price = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: product.currency,
      maximumFractionDigits: 2,
    }).format(product.priceCents / 100);
  } catch {
    price = `${product.currency} ${(product.priceCents / 100).toFixed(2)}`;
  }
  return `${product.name} · ${price}`;
}

export interface AddSongProjectOption {
  id: string;
  title: string;
  clientName: string | null;
  emptySlots: readonly {
    id: string;
    purchaseId: string;
    slotNumber: number;
    label: string;
  }[];
  paidExtraProducts?: readonly PaidExtraProductOption[];
  noChargeAvailable?: boolean;
  noChargeUnavailableReason?: string | null;
}

interface AddSongDialogProps {
  open: boolean;
  onClose: () => void;
  projects: readonly AddSongProjectOption[];
  initialProjectId?: string;
  initialPurchaseId?: string;
  lockInitialProject?: boolean;
}

export function AddSongDialog({
  open,
  onClose,
  projects,
  initialProjectId,
  initialPurchaseId,
  lockInitialProject = false,
}: AddSongDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [paidExtraProductId, setPaidExtraProductId] = useState("");
  const [noChargeProposal, setNoChargeProposal] = useState<{
    proposalToken: string;
    projectTitle: string;
    songTitle: string;
  } | null>(null);
  const [useAnySlot, setUseAnySlot] = useState(false);
  const operationKeyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    const preferred = projects.find((project) => project.id === initialProjectId);
    setProjectId(preferred?.id ?? (initialProjectId ? "" : (projects[0]?.id ?? "")));
    setTitle("");
    setArtist("");
    setPaidExtraProductId("");
    setNoChargeProposal(null);
    setUseAnySlot(false);
    if (!operationKeyRef.current) operationKeyRef.current = crypto.randomUUID();
  }, [initialProjectId, open, projects]);

  const project = useMemo(
    () => projects.find((candidate) => candidate.id === projectId) ?? null,
    [projectId, projects],
  );
  const slot = useMemo(() => {
    if (!project) return null;
    if (initialPurchaseId && !useAnySlot) {
      return (
        project.emptySlots.find((candidate) => candidate.purchaseId === initialPurchaseId) ?? null
      );
    }
    return project.emptySlots[0] ?? null;
  }, [initialPurchaseId, project, useAnySlot]);
  const exactSlotUnavailable = Boolean(
    project && initialPurchaseId && !useAnySlot && slot === null,
  );
  const paidExtraProducts = project?.paidExtraProducts ?? [];
  const selectedPaidExtraProduct =
    paidExtraProducts.find((product) => product.id === paidExtraProductId) ?? null;

  const claim = () => {
    const normalizedTitle = title.trim();
    if (!project || !slot || !normalizedTitle || pending) return;
    if (!online) {
      toast("Reconnect to add this song.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const result = await claimSongSpaceAction({
          projectId: project.id,
          purchaseId: slot.purchaseId,
          operationKey: operationKeyRef.current,
          title: normalizedTitle,
          ...(artist.trim() ? { artist: artist.trim() } : {}),
        });
        if (!result.ok) {
          toast(result.error, "error");
          router.refresh();
          return;
        }
        operationKeyRef.current = "";
        toast("Song added", "success");
        onClose();
        router.push(projectSongUploadHref(result.data.projectId, result.data.id));
      } catch {
        toast("Could not add this song. Try again.", "error");
      }
    });
  };

  const createNoCharge = () => {
    const normalizedTitle = title.trim();
    if (!project || slot || !project.noChargeAvailable || !normalizedTitle || pending) return;
    if (!online) {
      toast("Reconnect to create this proposal.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const result = await createNoChargeSongProposalAction({
          projectId: project.id,
          operationKey: operationKeyRef.current,
          title: normalizedTitle,
        });
        if (!result.ok) {
          toast(result.error, "error");
          router.refresh();
          return;
        }
        operationKeyRef.current = "";
        setNoChargeProposal({
          proposalToken: result.data.proposalToken,
          projectTitle: result.data.projectTitle,
          songTitle: result.data.title,
        });
        toast("No charge proposal ready", "success");
      } catch {
        toast("Could not create this proposal. Try again.", "error");
      }
    });
  };

  const copyNoChargeProposal = async () => {
    if (!noChargeProposal) return;
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (!clipboard) {
      toast("Couldn't copy the artist proposal", "error");
      return;
    }
    try {
      await clipboard.writeText(buildNoChargeProposalMessage(noChargeProposal));
      toast("Artist proposal copied", "success");
    } catch {
      toast("Couldn't copy the artist proposal", "error");
    }
  };

  const copyPaidExtraMessage = async () => {
    if (!project || !selectedPaidExtraProduct) return;
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (!clipboard) {
      toast("Couldn't copy the artist purchase message", "error");
      return;
    }
    try {
      await clipboard.writeText(
        buildPaidExtraArtistMessage({
          productId: selectedPaidExtraProduct.id,
          productName: selectedPaidExtraProduct.name,
          projectTitle: project.title,
        }),
      );
      toast("Artist purchase message copied", "success");
    } catch {
      toast("Couldn't copy the artist purchase message", "error");
    }
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          aria-describedby="add-song-dialog-description"
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[18px] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                Add Song
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                id="add-song-dialog-description"
                className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]"
              >
                Choose an active project, then claim one exact purchased song space.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="-mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]"
              >
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {projects.length === 0 ? (
            <div className="mt-5 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 text-center">
              <p className="text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                You need an active project first.
              </p>
              <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
                Create the project, then its purchase can provide the first song space.
              </p>
              <Link
                href="/dashboard/clients-projects?newProject=1"
                onClick={onClose}
                className="mt-4 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))]"
              >
                <Plus size={14} />
                New Project
              </Link>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                  Active project
                </span>
                <select
                  value={projectId}
                  disabled={lockInitialProject}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setTitle("");
                    setArtist("");
                    setPaidExtraProductId("");
                    setNoChargeProposal(null);
                    setUseAnySlot(true);
                    operationKeyRef.current = crypto.randomUUID();
                  }}
                  className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] sm:text-[14px]"
                >
                  {!projectId ? (
                    <option value="" disabled>
                      Choose an active project
                    </option>
                  ) : null}
                  {projects.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                      {option.clientName ? ` · ${option.clientName}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {exactSlotUnavailable ? (
                <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                  <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                    This purchased song space is no longer available.
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                    The Library changed after this row opened. Review the project’s current options
                    before allocating anything else.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setUseAnySlot(true);
                    }}
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
                  >
                    Review current options
                  </button>
                </div>
              ) : slot ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    claim();
                  }}
                >
                  <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--brand-primary)/0.09)] px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                      {slot.label} is ready
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
                      This allocation is one-time and stays tied to its purchase.
                    </p>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                      Song title
                    </span>
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                      }}
                      placeholder="Untitled song"
                      className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] sm:text-[14px]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                      Featured artist{" "}
                      <span className="font-normal text-[rgb(var(--fg-muted))]">(optional)</span>
                    </span>
                    <input
                      maxLength={120}
                      value={artist}
                      onChange={(event) => {
                        setArtist(event.target.value);
                      }}
                      className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] sm:text-[14px]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!title.trim() || pending}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={14} />
                    {pending ? "Adding…" : "Add Song"}
                  </button>
                </form>
              ) : project ? (
                <div className="space-y-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                  <div>
                    <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                      No unused purchased spaces
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                      A paid extra becomes usable only after the complete first installment is
                      confirmed. A No charge extra must create its own ₪0 purchase history.
                    </p>
                  </div>
                  {paidExtraProducts.length > 0 ? (
                    <div className="space-y-2.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                          Paid extra product
                        </span>
                        <select
                          value={paidExtraProductId}
                          onChange={(event) => {
                            setPaidExtraProductId(event.target.value);
                          }}
                          className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-[16px] text-[rgb(var(--fg-default))] sm:text-[14px]"
                        >
                          <option value="">Choose a per-song product</option>
                          {paidExtraProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {formatPaidExtraProduct(product)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                        Copy this message to the artist. They must sign in, choose one song, select
                        Add to an existing project, and choose the exact project “{project.title}”.
                        Nothing is allocated or accepted here; signed-in artist acceptance is
                        required.
                      </p>
                      <button
                        type="button"
                        disabled={!selectedPaidExtraProduct}
                        onClick={() => {
                          void copyPaidExtraMessage();
                        }}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[13px] font-semibold text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Copy aria-hidden size={14} />
                        Copy artist purchase message
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] p-3">
                      <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                        No paid extra product available
                      </p>
                      <p className="mt-1 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                        No enabled positive-price per-song Store product is available. Publish one
                        before starting a paid extra with the artist.
                      </p>
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                      Song title
                    </span>
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      disabled={noChargeProposal !== null}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                      }}
                      placeholder="Untitled song"
                      className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 text-[16px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] sm:text-[14px]"
                    />
                  </label>
                  {noChargeProposal ? (
                    <div className="space-y-2.5 rounded-[var(--radius-lg)] border border-[rgb(var(--focus-ring))] bg-[rgb(var(--brand-primary)/0.08)] p-3">
                      <div>
                        <p className="text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
                          Artist acceptance required
                        </p>
                        <p className="mt-1 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                          The proposal is ready, but no purchase or song space exists yet. Send this
                          signed-in review link to the matching artist.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void copyNoChargeProposal();
                        }}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3 text-[13px] font-semibold text-[rgb(var(--bg-background))]"
                      >
                        <Copy aria-hidden size={14} />
                        Copy artist review link
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={createNoCharge}
                        disabled={!project.noChargeAvailable || !title.trim() || pending}
                        title={
                          project.noChargeAvailable
                            ? "Create a ₪0 proposal for artist acceptance"
                            : (project.noChargeUnavailableReason ?? "No reusable product source")
                        }
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-3 text-[13px] font-semibold text-[rgb(var(--bg-background))] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {pending ? "Creating…" : "Create ₪0 proposal"}
                      </button>
                      <p className="text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
                        {project.noChargeAvailable
                          ? "The matching artist must review and accept before a separate ₪0 purchase and song space are created."
                          : (project.noChargeUnavailableReason ??
                            "No reusable ILS product-backed purchase source was found.")}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                  <p className="text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                    This project is unavailable for new work.
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                    {lockInitialProject
                      ? "The selected project is no longer active. Close this sheet and review the Library before allocating anything else."
                      : "Choose another active project above. Nothing will be allocated until you make that choice."}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
