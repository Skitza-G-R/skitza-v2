"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Minimal toast system — no new deps, no external state library.
// Exports: <ToastProvider>, useToast(), <Toaster>.
//
// Used for the kind of in-app success feedback that the full UI banners
// can't cover: "Track saved", "Link revoked". Errors prefer inline
// placement (adjacent to the failing control) because context matters
// more than a corner notification for errors.

type ToastVariant = "success" | "info" | "error";

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>(
    (message, variant = "info") => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((ts) => [...ts, { id, message, variant }]);
      const timer = setTimeout(() => { dismiss(id); }, TOAST_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Clean up all pending timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const timer of t.values()) clearTimeout(timer);
      t.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Callers outside the provider (shouldn't happen — provider is in
    // root layout) get a no-op so nothing crashes in e.g. server-only
    // code paths that accidentally import this.
    return {
      toast: () => {
        /* no-op when used outside provider */
      },
    };
  }
  return ctx;
}

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6"
    >
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            onClick={() => { onDismiss(t.id); }}
            className={[
              "pointer-events-auto flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 font-mono text-sm shadow-[var(--shadow-md)] backdrop-blur",
              "reveal-up cursor-pointer",
              t.variant === "success" &&
                "border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--fg-primary))]",
              t.variant === "error" &&
                "border-[rgb(var(--fg-danger)/0.5)] bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-primary))]",
              t.variant === "info" &&
                "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span
              aria-hidden
              className={[
                "h-1.5 w-1.5 shrink-0 rounded-full",
                t.variant === "success" && "bg-[rgb(var(--brand-primary))]",
                t.variant === "error" && "bg-[rgb(var(--fg-danger))]",
                t.variant === "info" && "bg-[rgb(var(--fg-muted))]",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            <span className="flex-1 truncate">{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
