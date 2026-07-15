"use client";

import { UserAvatar, UserButton } from "@clerk/nextjs";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { copyPublicLink } from "~/components/dashboard/overview/public-link-strip";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountSheetId = useId();

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

      <UserButton __experimental_asProvider>
        <div data-testid="topbar-account" className="flex h-10 w-10 items-center justify-center">
          <button
            ref={accountButtonRef}
            type="button"
            aria-label="Open account menu"
            aria-haspopup="dialog"
            aria-expanded={accountOpen}
            aria-controls={accountOpen ? accountSheetId : undefined}
            onClick={() => {
              setAccountOpen(true);
            }}
            className="sk-press inline-flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <UserAvatar
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
                },
              }}
            />
          </button>

          <Sheet open={accountOpen} onOpenChange={setAccountOpen}>
            <SheetContent
              side="bottom"
              id={accountSheetId}
              data-testid="account-sheet"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                accountButtonRef.current?.focus();
              }}
              className="max-h-[88dvh] w-full gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
            >
              <SheetTitle className="sr-only">Account</SheetTitle>
              <SheetDescription className="sr-only">
                Manage your account or sign out.
              </SheetDescription>
              <div className="w-full p-4 pt-2">
                <UserButton.__experimental_Outlet
                  defaultOpen
                  __experimental_asStandalone={(opened) => {
                    if (!opened) setAccountOpen(false);
                  }}
                  appearance={{
                    elements: {
                      rootBox: "w-full",
                      userButtonPopoverCard:
                        "w-full max-w-none border-0 bg-transparent shadow-none",
                    },
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </UserButton>
    </div>
  );
}
