"use client";

import { Download, Share } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  capturedNativeInstallPrompt,
  clearCapturedNativeInstallPrompt,
  dismissInstallGuidance,
  INSTALL_PROMPT_AVAILABLE_EVENT,
  installGuidanceEligible,
  isIphoneLike,
  isStandaloneDisplay,
  markNativeAppInstalled,
  readInstallGuidanceState,
  type NativeInstallPromptEvent,
} from "~/lib/pwa/install-guidance";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";

export function NativeInstallGuidance({ role }: { role: "producer" | "artist" }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<NativeInstallPromptEvent | null>(null);
  const [iphone, setIphone] = useState(false);

  const evaluate = useCallback(() => {
    const nextPrompt = capturedNativeInstallPrompt();
    const isIphone = isIphoneLike(navigator.userAgent);
    const state = readInstallGuidanceState();
    const eligible = installGuidanceEligible({
      signedIn: true,
      installed: state.installed,
      standalone: isStandaloneDisplay(),
      currentSessionId: state.sessionId,
      action: state.action,
      dismissedAt: state.dismissedAt,
      now: state.now,
    });
    setPrompt(nextPrompt);
    setIphone(isIphone);
    setOpen(eligible && (isIphone || nextPrompt !== null));
  }, []);

  useEffect(() => {
    evaluate();
    const onPrompt = () => {
      evaluate();
    };
    const onInstalled = () => {
      markNativeAppInstalled();
      clearCapturedNativeInstallPrompt();
      setOpen(false);
    };
    window.addEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [evaluate]);

  const dismiss = useCallback(() => {
    dismissInstallGuidance();
    setOpen(false);
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      clearCapturedNativeInstallPrompt();
      setPrompt(null);
      if (choice.outcome === "accepted") {
        markNativeAppInstalled();
        setOpen(false);
        return;
      }
      dismiss();
    } catch {
      dismiss();
    }
  }, [dismiss, prompt]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && open) dismiss();
      }}
    >
      <SheetContent
        side="bottom"
        aria-label={`Install Skitza for ${role}`}
        className="mx-auto max-w-xl"
      >
        <SheetHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]">
            {iphone ? <Share size={20} aria-hidden /> : <Download size={20} aria-hidden />}
          </div>
          <SheetTitle>Keep Skitza one tap away</SheetTitle>
          <SheetDescription>
            {iphone
              ? "In Safari, tap Share, then Add to Home Screen."
              : "Install Skitza to open it without browser bars and return faster."}
          </SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <button
            type="button"
            onClick={dismiss}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-sm font-semibold text-[rgb(var(--fg-secondary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
          >
            Not now
          </button>
          {!iphone && prompt ? (
            <button
              type="button"
              onClick={() => {
                void install();
              }}
              className="sk-press min-h-11 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
            >
              Install Skitza
            </button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
