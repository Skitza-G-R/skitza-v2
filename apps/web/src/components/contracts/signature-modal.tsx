"use client";

// Full-screen signature capture — react-signature-canvas inside a
// viewport-filling overlay. Drawing surface uses touch-action:none so
// finger drags don't scroll the page while the user is signing. Save
// is gated on isEmpty() so an accidental tap doesn't produce a
// zero-byte data URL.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CanvasHTMLAttributes,
  type ComponentType,
  type Ref,
} from "react";
import SignatureCanvasImport from "react-signature-canvas";

import { cn } from "~/lib/cn";

// react-signature-canvas still ships class-component typings that
// don't satisfy React 19's stricter class-component constraint
// (componentDidMount is now required upstream types have it
// optional). The runtime class works fine — we just narrow its type
// to a functional-like ComponentType so TSX can render it. No
// behavioural change.
//
// We hand-declare the subset of props we use here rather than pulling
// ReactSignatureCanvas.ReactSignatureCanvasProps from the `export =`
// namespace (which is awkward to re-export under moduleResolution
// bundler).
interface SignatureCanvasProps {
  canvasProps?: CanvasHTMLAttributes<HTMLCanvasElement>;
  backgroundColor?: string;
  penColor?: string;
  minWidth?: number;
  maxWidth?: number;
  onBegin?: () => void;
  ref?: Ref<SignatureCanvasImport>;
}

const SignatureCanvas =
  SignatureCanvasImport as unknown as ComponentType<SignatureCanvasProps>;

interface SignatureModalProps {
  kind: "signature" | "initial";
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

export function SignatureModal({ kind, onSave, onClose }: SignatureModalProps) {
  const canvasRef = useRef<SignatureCanvasImport | null>(null);
  const [empty, setEmpty] = useState(true);

  // Escape to close. Focus is NOT auto-captured onto the canvas
  // itself (it's not focusable), so the overlay absorbs tab presses
  // via the focused Clear button below.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Lock body scroll while open so two-finger pan on iOS doesn't
  // scroll the underlying document.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const clear = useCallback(() => {
    canvasRef.current?.clear();
    setEmpty(true);
  }, []);

  const save = useCallback(() => {
    const c = canvasRef.current;
    if (!c || c.isEmpty()) return;
    // Use the trimmed canvas so the saved PNG is tight around the
    // stroke bounds — the signer's field rect is often much shorter
    // than the modal, and a full-canvas image would scale down into
    // an illegible speck.
    const trimmed = c.getTrimmedCanvas();
    onSave(trimmed.toDataURL("image/png"));
  }, [onSave]);

  const label = kind === "initial" ? "Draw your initials" : "Draw your signature";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col bg-[rgb(var(--bg-base))]"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <header className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-4 py-3">
        <h2
          className="font-display text-lg tracking-tight"
          style={{ fontWeight: 700 }}
        >
          {label}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] rounded-[var(--radius-md)] px-3 font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-sunken))]"
          aria-label="Close"
        >
          Close
        </button>
      </header>

      <div
        className="relative flex-1 bg-[rgb(var(--bg-elevated))]"
        // Prevent pinch-zoom / pan-scroll from eating drag events.
        style={{ touchAction: "none" }}
      >
        <SignatureCanvas
          ref={canvasRef}
          canvasProps={{
            className: "h-full w-full",
            style: { touchAction: "none" },
          }}
          backgroundColor="rgba(0,0,0,0)"
          penColor="rgb(26,23,20)"
          minWidth={1.2}
          maxWidth={2.6}
          onBegin={() => {
            setEmpty(false);
          }}
        />
        {empty ? (
          <p
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]"
          >
            Sign inside this box
          </p>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-[rgb(var(--border-subtle))] px-4 py-3">
        <button
          type="button"
          onClick={clear}
          disabled={empty}
          className={cn(
            "min-h-[44px] rounded-[var(--radius-md)] px-4 font-medium transition-colors",
            "border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]",
            "hover:bg-[rgb(var(--bg-sunken))]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={save}
          disabled={empty}
          className={cn(
            "min-h-[44px] rounded-[var(--radius-md)] px-5 font-medium transition-colors",
            "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
            "hover:bg-[rgb(var(--brand-primary)/0.9)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          Save
        </button>
      </footer>
    </div>
  );
}
