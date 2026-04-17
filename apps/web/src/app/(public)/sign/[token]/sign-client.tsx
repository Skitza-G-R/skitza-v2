"use client";

import { type SyntheticEvent, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { submitSignature } from "./actions";

interface Props {
  token: string;
  artistName: string;
  producerName: string;
  initialStatus: "sent" | "viewed" | "signed" | "cancelled" | "expired" | "draft";
  initialSignedAt: Date | null;
}

// Canvas-based signature pad. Stores the drawn ink as a data URL and
// submits it via the Server Action. Pointer events handle desktop +
// mobile + stylus uniformly.
export function SignClient({
  token,
  artistName,
  producerName,
  initialStatus,
  initialSignedAt,
}: Props) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [signed, setSigned] = useState(initialStatus === "signed");
  const [signedAt, setSignedAt] = useState<Date | null>(initialSignedAt);
  const [error, setError] = useState<string | null>(null);
  const [acceptedName, setAcceptedName] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  // Size the canvas to its CSS width with device-pixel-ratio scaling
  // so strokes stay crisp on retina + mobile.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const w = parent.clientWidth;
      const h = 160;
      canvas.style.width = `${String(w)}px`;
      canvas.style.height = `${String(h)}px`;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#1A1714";
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  function getPoint(e: PointerEvent | React.PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (signed) return;
    e.preventDefault();
    drawing.current = true;
    hasInk.current = true;
    lastPt.current = getPoint(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pt = getPoint(e);
    if (!pt) return;
    const last = lastPt.current ?? pt;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPt.current = pt;
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    lastPt.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function clearInk() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  }

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!hasInk.current) {
      setError("Please sign above with your finger, mouse, or stylus.");
      return;
    }
    if (!acceptedName.trim()) {
      setError("Type your name to confirm.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    startTransition(async () => {
      const res = await submitSignature({
        token,
        signatureDataUrl: dataUrl,
        acceptedName: acceptedName.trim(),
      });
      if (res.ok) {
        toast(
          res.alreadySigned ? "Already signed earlier." : "Signed.",
          "success",
        );
        setSigned(true);
        setSignedAt(new Date());
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  if (signed) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.08)] p-5">
        <p className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[rgb(var(--brand-primary))]">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]" />
          Signed
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-primary))]">
          Thanks, {artistName}. {producerName} has a copy. You can keep this page as
          your record.
        </p>
        {signedAt ? (
          <p className="mt-2 font-mono text-xs text-[rgb(var(--fg-muted))]">
            Signed {signedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        ) : null}
      </div>
    );
  }

  if (initialStatus === "cancelled" || initialStatus === "expired") {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--fg-danger)/0.5)] bg-[rgb(var(--fg-danger)/0.08)] p-5">
        <p className="font-display text-lg" style={{ fontWeight: 700 }}>
          This contract is {initialStatus}.
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Reach out to {producerName} for a new one.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5"
    >
      <Label htmlFor="sigCanvas">Your signature</Label>
      <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-white">
        <canvas
          id="sigCanvas"
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
          className="block w-full touch-none"
          style={{ touchAction: "none" }}
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clearInk}
          className="font-mono text-xs text-[rgb(var(--fg-secondary))] underline-offset-4 hover:text-[rgb(var(--fg-primary))] hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="mt-5">
        <Label htmlFor="typedName">Type your full name to confirm</Label>
        <Input
          id="typedName"
          type="text"
          value={acceptedName}
          onChange={(e) => {
            setAcceptedName(e.target.value);
          }}
          placeholder={artistName}
          required
          maxLength={120}
        />
        <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
          Must match the name the producer sent this contract to.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Signing…" : "Sign & submit"}
        </Button>
      </div>
      <p className="mt-3 text-center font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        Legally binding · timestamp + device recorded in the audit trail
      </p>
    </form>
  );
}
