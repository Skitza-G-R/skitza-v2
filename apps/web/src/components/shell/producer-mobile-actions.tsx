"use client";

import { UserButton } from "@clerk/nextjs";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import { copyPublicLink } from "~/components/dashboard/overview/public-link-strip";
import { useToast } from "~/components/ui/toast";
import { buildJoinUrl } from "~/lib/share/public-url";

interface ProducerMobileActionsProps {
  producerSlug: string | null;
}

export function ProducerMobileActions({
  producerSlug,
}: ProducerMobileActionsProps) {
  const { toast } = useToast();
  const tToasts = useTranslations("today.toasts");

  async function copyLink() {
    if (!producerSlug) return;
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    const writeText = clipboard ? clipboard.writeText.bind(clipboard) : undefined;
    const copied = await copyPublicLink(buildJoinUrl(producerSlug), writeText);
    toast(
      copied ? tToasts("copied") : tToasts("couldNotCopy"),
      copied ? "success" : "error",
    );
  }

  return (
    <div
      data-testid="producer-mobile-actions"
      className="flex flex-shrink-0 items-center gap-0.5 lg:hidden"
    >
      {producerSlug ? (
        <button
          type="button"
          onClick={() => {
            void copyLink();
          }}
          aria-label="Copy public link"
          title="Copy public link"
          className="sk-press inline-flex h-10 w-10 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <Copy aria-hidden size={18} strokeWidth={2} />
        </button>
      ) : null}

      <div data-testid="topbar-account" className="flex h-10 w-10 items-center justify-center">
        <UserButton
          appearance={{
            elements: {
              rootBox: "flex h-10 w-10 items-center justify-center",
              userButtonTrigger:
                "h-10 w-10 rounded-full focus:shadow-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
              avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
            },
          }}
        />
      </div>
    </div>
  );
}
