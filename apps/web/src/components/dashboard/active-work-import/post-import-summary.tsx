"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";

import { buildClientInviteUrl } from "~/lib/clients/invite-url";

import {
  artistShareMessage,
  formatImportMoney,
  postImportSummary,
  type MoneyByCurrency,
  type SetupClientOption,
  type SetupInstallmentOption,
  type WorkspaceImportRow,
} from "./model";

function dueLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function moneyLabel(owed: readonly MoneyByCurrency[]): string | null {
  if (owed.length === 0) return null;
  return owed.map((entry) => formatImportMoney(entry.cents, entry.currency)).join(" + ");
}

/**
 * The screen the producer lands on once their real work is inside Skitza: what
 * they are owed, when it lands, and one tap to send each artist their link.
 *
 * Sharing here is deliberately not an invitation. Copy and WhatsApp hand the
 * producer a message to send themselves; only the email step can mark a client
 * Invited, because Invited means the email provider accepted a send.
 */
export function PostImportSummary({
  rows,
  installments,
  clients,
  producerSlug,
  producerName,
  onShared,
  onDone,
}: {
  rows: readonly WorkspaceImportRow[];
  installments: readonly SetupInstallmentOption[];
  clients: readonly SetupClientOption[];
  producerSlug: string;
  producerName: string;
  onShared?: (channel: "whatsapp" | "copy") => void;
  onDone: () => void;
}) {
  const [copiedClientId, setCopiedClientId] = useState<string | null>(null);
  const summary = postImportSummary({ rows, installments, clients });
  const inviteUrl = buildClientInviteUrl(producerSlug);
  const owedLabel = moneyLabel(summary.owed);
  const nextDue = dueLabel(summary.nextDueAtIso);
  const artistCount = summary.artists.length;

  function messageFor(artist: (typeof summary.artists)[number]): string {
    return artistShareMessage({
      artistName: artist.name,
      projectTitle: artist.projectTitles[0] ?? "",
      producerName,
      url: inviteUrl,
    });
  }

  async function copyFor(artist: (typeof summary.artists)[number]) {
    try {
      await navigator.clipboard.writeText(messageFor(artist));
      setCopiedClientId(artist.clientContactId);
      onShared?.("copy");
    } catch {
      setCopiedClientId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-5">
      <div>
        <h2 className="text-[19px] leading-tight font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))] sm:text-[22px]">
          {artistCount === 1
            ? "Your artist is in Skitza."
            : `Your ${String(artistCount)} artists are in Skitza.`}
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Nothing was sent to anyone. Send each artist their link when you are ready.
        </p>
      </div>

      {owedLabel ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
            <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              You are owed
            </p>
            <p className="mt-1 text-[20px] leading-tight font-extrabold text-[rgb(var(--fg-default))]">
              {owedLabel}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
            <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase">
              Next payment
            </p>
            <p className="mt-1 text-[20px] leading-tight font-extrabold text-[rgb(var(--fg-default))]">
              {nextDue ?? "No date yet"}
            </p>
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2.5">
        {summary.artists.map((artist) => {
          const artistOwed = moneyLabel(artist.owed);
          const artistDue = dueLabel(artist.nextDueAtIso);
          const copied = copiedClientId === artist.clientContactId;
          const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(messageFor(artist))}`;
          return (
            <li
              key={artist.clientContactId}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-[rgb(var(--fg-default))]">
                  {artist.name}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
                  {artistOwed && artistDue
                    ? `Owes ${artistOwed}, due ${artistDue}.`
                    : artistOwed
                      ? `Owes ${artistOwed}.`
                      : "Fully paid."}
                  {artist.reminderArmed && artistDue
                    ? ` Skitza will remind ${artist.name.trim().split(/\s+/)[0] ?? "them"} about it.`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    onShared?.("whatsapp");
                  }}
                  className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-3 text-[12.5px] font-bold text-[rgb(var(--fg-on-brand))]"
                >
                  <MessageCircle size={15} strokeWidth={2.2} aria-hidden />
                  WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void copyFor(artist);
                  }}
                  className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3 text-[12.5px] font-bold text-[rgb(var(--fg-default))]"
                >
                  {copied ? (
                    <Check size={15} strokeWidth={2.4} aria-hidden />
                  ) : (
                    <Copy size={15} strokeWidth={2.2} aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onDone}
        className="sk-press inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[13px] font-bold text-[rgb(var(--fg-default))] sm:w-fit"
      >
        Go to my dashboard
      </button>
    </div>
  );
}
