"use client";

import { ArrowLeft, Check, Download, Menu, Share, SquarePlus, WifiOff } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import {
  capturedNativeInstallPrompt,
  clearCapturedNativeInstallPrompt,
  dismissInstallGuidance,
  INSTALL_GUIDANCE_OPEN_EVENT,
  INSTALL_PROMPT_AVAILABLE_EVENT,
  installGuidanceEligible,
  isAppleMobileDevice,
  isMobileInstallDevice,
  isStandaloneDisplay,
  markNativeAppInstalled,
  mobileInstallGuidanceEligible,
  readInstallGuidanceState,
  type NativeInstallPromptEvent,
} from "~/lib/pwa/install-guidance";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";

const AUTO_OPEN_DELAY_MS = 700;

type GuidanceView = "invitation" | "instructions";

function anotherDialogIsOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

function InstallStep({
  detail,
  icon,
  title,
}: Readonly<{
  detail?: string;
  icon: ReactNode;
  title: string;
}>) {
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-2.5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-text))]"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[rgb(var(--fg-default))]">{title}</span>
        {detail ? (
          <span className="mt-0.5 block text-xs leading-5 text-[rgb(var(--fg-muted))]">
            {detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function NativeInstallGuidance({ role }: Readonly<{ role: "artist" | "producer" }>) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<GuidanceView>("invitation");
  const [prompt, setPrompt] = useState<NativeInstallPromptEvent | null>(null);
  const [appleMobile, setAppleMobile] = useState(false);
  const [online, setOnline] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [nativePromptFailed, setNativePromptFailed] = useState(false);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);

  const evaluate = useCallback(
    ({
      focusTarget = null,
      manual = false,
    }: Readonly<{
      focusTarget?: HTMLElement | null;
      manual?: boolean;
    }> = {}) => {
      const platformValue: unknown = Reflect.get(navigator, "platform");
      const device = {
        userAgent: navigator.userAgent,
        platform: typeof platformValue === "string" ? platformValue : "",
        maxTouchPoints: navigator.maxTouchPoints,
      };
      const isAppleMobile = isAppleMobileDevice(device);
      const isMobile = isMobileInstallDevice(device);
      const standalone = isStandaloneDisplay();
      const state = readInstallGuidanceState();
      const nativePrompt = capturedNativeInstallPrompt();
      const eligible = isMobile
        ? mobileInstallGuidanceEligible({
            signedIn: true,
            installed: state.installed,
            standalone,
            dismissedAt: state.dismissedAt,
            now: state.now,
          })
        : installGuidanceEligible({
            signedIn: true,
            installed: state.installed,
            standalone,
            currentSessionId: state.sessionId,
            action: state.action,
            dismissedAt: state.dismissedAt,
            now: state.now,
          });
      const canOpenManually = !standalone && !state.installed;

      setPrompt(nativePrompt);
      setAppleMobile(isAppleMobile);
      setOnline(navigator.onLine);

      if (manual ? !canOpenManually : !eligible) return;
      if (!manual && !isMobile && !nativePrompt) return;
      if (!manual && anotherDialogIsOpen()) return;

      setInstalling(false);
      setNativePromptFailed(false);
      setReturnFocusTo(focusTarget);
      setView("invitation");
      setOpen(true);
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      evaluate();
    }, AUTO_OPEN_DELAY_MS);
    const onPromptAvailable = () => {
      evaluate();
    };
    const onManualOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{
        returnFocusTo?: HTMLElement;
      }>;
      evaluate({
        manual: true,
        focusTarget: customEvent.detail.returnFocusTo ?? null,
      });
    };
    const onInstalled = () => {
      markNativeAppInstalled();
      clearCapturedNativeInstallPrompt();
      setPrompt(null);
      setOpen(false);
    };
    const onConnectionChange = () => {
      setOnline(navigator.onLine);
    };
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => {
      if (displayMode.matches) setOpen(false);
    };

    window.addEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, onPromptAvailable);
    window.addEventListener(INSTALL_GUIDANCE_OPEN_EVENT, onManualOpen);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onConnectionChange);
    window.addEventListener("offline", onConnectionChange);
    displayMode.addEventListener("change", onDisplayModeChange);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(INSTALL_PROMPT_AVAILABLE_EVENT, onPromptAvailable);
      window.removeEventListener(INSTALL_GUIDANCE_OPEN_EVENT, onManualOpen);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onConnectionChange);
      window.removeEventListener("offline", onConnectionChange);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, [evaluate]);

  const dismiss = useCallback(() => {
    dismissInstallGuidance();
    setOpen(false);
    if (returnFocusTo) {
      window.setTimeout(() => {
        returnFocusTo.focus();
      }, 0);
    }
  }, [returnFocusTo]);

  const install = useCallback(async () => {
    if (!online || installing) return;
    if (!prompt) {
      setView("instructions");
      return;
    }

    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      clearCapturedNativeInstallPrompt();
      setPrompt(null);
      if (choice.outcome === "accepted") {
        markNativeAppInstalled();
        setOpen(false);
      } else {
        dismiss();
      }
    } catch {
      clearCapturedNativeInstallPrompt();
      setPrompt(null);
      setNativePromptFailed(true);
      setView("instructions");
    } finally {
      setInstalling(false);
    }
  }, [dismiss, installing, online, prompt]);

  const title =
    view === "invitation"
      ? "Get the Skitza app"
      : appleMobile
        ? "Add Skitza to your Home Screen"
        : "Install Skitza from your browser";
  const description =
    view === "invitation"
      ? "Open Skitza full screen, straight from your Home Screen."
      : appleMobile
        ? "Three quick steps, then Skitza opens like an app."
        : "Use your browser’s install option to finish adding Skitza.";

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) dismiss();
        else setOpen(nextOpen);
      }}
    >
      <SheetContent
        aria-label={title}
        className="mx-auto max-h-[min(92dvh,44rem)] max-w-md gap-0 overflow-y-auto p-0 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:p-0 sm:pb-4"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo) return;
          event.preventDefault();
          returnFocusTo.focus();
        }}
      >
        <div className="relative mx-3 mt-2 overflow-hidden rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-5 py-5 text-[rgb(var(--fg-onsidebar))]">
          <span
            aria-hidden
            className="absolute -top-10 -right-8 size-28 rounded-full border border-[rgb(var(--accent)/0.25)]"
          />
          <span
            aria-hidden
            className="absolute -right-2 -bottom-12 size-24 rounded-full bg-[rgb(var(--accent)/0.12)]"
          />

          <SheetHeader className="relative gap-4">
            <div className="flex items-center gap-3.5">
              <span className="flex size-[68px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--accent))] shadow-[0_12px_32px_rgb(var(--accent)/0.2)]">
                <Image
                  alt="Skitza"
                  className="size-[52px] rounded-[var(--radius-md)]"
                  height={52}
                  priority
                  src="/icons/skitza-192.png"
                  width={52}
                />
              </span>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-bold tracking-[0.16em] text-[rgb(var(--accent))] uppercase">
                  {role === "producer" ? "Your studio, closer" : "Your music, closer"}
                </p>
                <p className="text-sm font-medium text-[rgb(var(--fg-onsidebar)/0.7)]">
                  One tap from your phone
                </p>
              </div>
            </div>
            <div>
              <SheetTitle className="text-[1.6rem] leading-[1.1] text-[rgb(var(--fg-onsidebar))]">
                {title}
              </SheetTitle>
              <SheetDescription className="mt-2 max-w-[34ch] text-sm leading-6 text-[rgb(var(--fg-onsidebar)/0.72)]">
                {description}
              </SheetDescription>
            </div>
          </SheetHeader>
        </div>

        <div className="px-5 pt-5">
          {view === "invitation" ? (
            <>
              <ul className="space-y-3" aria-label="App benefits">
                <li className="flex items-start gap-3 text-sm text-[rgb(var(--fg-default))]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]"
                  >
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                  <span>Launch Skitza from your Home Screen</span>
                </li>
                <li className="flex items-start gap-3 text-sm text-[rgb(var(--fg-default))]">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-success)/0.12)] text-[rgb(var(--fg-success-text))]"
                  >
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                  <span>Enjoy a focused, full-screen experience</span>
                </li>
              </ul>

              {!online ? (
                <p
                  className="mt-4 flex items-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-warning)/0.13)] px-3 py-2.5 text-sm font-medium text-[rgb(var(--fg-warning-text))]"
                  role="status"
                >
                  <WifiOff aria-hidden className="size-4 shrink-0" />
                  Reconnect to install Skitza.
                </p>
              ) : null}

              <div className="mt-5 grid gap-2.5">
                <button
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] transition-[transform,background-color] hover:bg-[rgb(var(--brand-primary-dark))] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                  disabled={!online || installing}
                  onClick={() => void install()}
                  type="button"
                >
                  <Download aria-hidden className="size-4" />
                  {installing
                    ? "Opening install…"
                    : online
                      ? "Install Skitza"
                      : "Reconnect to install"}
                </button>
                <button
                  className="h-11 w-full rounded-[var(--radius-lg)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] motion-reduce:transition-none"
                  onClick={dismiss}
                  type="button"
                >
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              {nativePromptFailed ? (
                <p
                  className="mb-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-warning)/0.13)] px-3 py-2.5 text-sm font-medium text-[rgb(var(--fg-warning-text))]"
                  role="status"
                >
                  The install window did not open. You can still add Skitza from your browser.
                </p>
              ) : null}

              <ol className="space-y-2.5">
                {appleMobile ? (
                  <>
                    <InstallStep
                      icon={<Share className="size-[18px]" />}
                      title="Open your browser’s Share menu"
                    />
                    <InstallStep
                      icon={<SquarePlus className="size-[18px]" />}
                      title="Choose Add to Home Screen"
                    />
                    <InstallStep
                      detail="If shown, leave Open as Web App turned on."
                      icon={<Check className="size-[18px]" />}
                      title="Tap Add"
                    />
                  </>
                ) : (
                  <>
                    <InstallStep
                      icon={<Menu className="size-[18px]" />}
                      title="Open your browser menu"
                    />
                    <InstallStep
                      detail="Some browsers call this Add to Home Screen."
                      icon={<Download className="size-[18px]" />}
                      title="Choose Install app"
                    />
                    <InstallStep
                      icon={<Check className="size-[18px]" />}
                      title="Confirm the installation"
                    />
                  </>
                )}
              </ol>

              <div className="mt-5 grid gap-2.5">
                <button
                  className="h-12 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--fg-on-brand))] shadow-[var(--shadow-sm)] transition-colors hover:bg-[rgb(var(--brand-primary-dark))] motion-reduce:transition-none"
                  onClick={dismiss}
                  type="button"
                >
                  Got it
                </button>
                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] px-4 text-sm font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] motion-reduce:transition-none"
                  onClick={() => {
                    setNativePromptFailed(false);
                    setView("invitation");
                  }}
                  type="button"
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
