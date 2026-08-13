"use client";

import { useSignIn } from "@clerk/nextjs";
import { useEffect } from "react";

import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  parseDesktopBridgeEvent,
} from "~/lib/desktop/bridge";

type TicketSignIn = Readonly<{
  finalize(): Promise<Readonly<{ error: unknown }>>;
  ticket(input: Readonly<{ ticket: string }>): Promise<Readonly<{ error: unknown }>>;
}>;

export async function redeemDesktopSignInTicket(
  input: Readonly<{
    navigate: () => void;
    signIn: TicketSignIn;
    ticket: string;
  }>,
): Promise<boolean> {
  // The ticket exists only in this call stack. Never put it in a URL, state,
  // storage, analytics, or logs, and never retry this one-use value.
  const redeemed = await input.signIn.ticket({ ticket: input.ticket });
  if (redeemed.error !== null) return false;
  const finalized = await input.signIn.finalize();
  if (finalized.error !== null) return false;
  input.navigate();
  return true;
}

export function DesktopAuthTicketBridge() {
  const { signIn } = useSignIn();

  useEffect(() => {
    const detection = detectDesktopBridge();
    if (!desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.socialAuth)) return;

    let inFlight = false;
    let disposed = false;
    let unlisten: () => void = () => undefined;
    try {
      unlisten = detection.bridge.listen((value) => {
        const event = parseDesktopBridgeEvent(value);
        if (disposed || inFlight || event?.type !== "social-sign-in-ticket") return;
        inFlight = true;
        void redeemDesktopSignInTicket({
          navigate: () => {
            window.location.replace("/launch/resolve");
          },
          signIn,
          ticket: event.ticket,
        })
          .catch(() => false)
          .finally(() => {
            inFlight = false;
          });
      });
    } catch {
      unlisten = () => undefined;
    }

    return () => {
      disposed = true;
      unlisten();
    };
  }, [signIn]);

  return null;
}
