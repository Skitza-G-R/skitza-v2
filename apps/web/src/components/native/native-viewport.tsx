"use client";

import { useEffect } from "react";

interface ViewportMeasurement {
  innerHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
  /** Whether a control that raises the iOS software keyboard holds focus. */
  textEntryFocused?: boolean;
}

/**
 * Controls that raise the iOS software keyboard. Kept in step with the selector
 * globals.css uses to hide the bottom nav, so both read the keyboard the same
 * way.
 */
export const TEXT_ENTRY_FOCUS_SELECTOR =
  'input:is(:not([type]), [type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"]):focus, textarea:focus, [contenteditable]:not([contenteditable="false"]):focus';

export interface NativeViewportMetrics {
  height: number;
  layoutTop: number;
  layoutHeight: number;
  offsetTop: number;
  keyboardInset: number;
  keyboardOpen: boolean;
}

export function calculateNativeViewportMetrics({
  innerHeight,
  viewportHeight,
  viewportOffsetTop,
  textEntryFocused = false,
}: ViewportMeasurement): NativeViewportMetrics {
  const measuredHeight = viewportHeight > 0 ? viewportHeight : innerHeight;
  const height = Math.max(1, Math.round(measuredHeight));
  const offsetTop = Math.max(0, Math.round(viewportOffsetTop));
  // Gap between the layout viewport's bottom edge and the bottom of the visible
  // strip. A `fixed; bottom:` surface — the action dock — needs exactly this.
  const obscuredHeight = Math.max(0, Math.round(innerHeight - measuredHeight - viewportOffsetTop));
  const keyboardThreshold = Math.min(200, Math.max(120, innerHeight * 0.18));
  // iOS does not always leave a measurable gap. Focusing a field deep enough
  // that the keyboard would cover it makes iOS scroll the visual viewport up to
  // lift it clear, and `innerHeight` collapses onto the visual viewport at the
  // same time — measured at innerHeight 478, height 471, offsetTop 300 on an
  // iPhone 17, so the subtraction above sees nothing obscured while the keyboard
  // fills half the screen. Reported "closed", that un-pinned every
  // `.sk-native-screen` (globals.css pins `top: 0` while the keyboard is closed)
  // and left the editor 300px above the visible strip, header and step nav with
  // it — SK-297.
  //
  // Fall back to the focused control, the signal globals.css already trusts to
  // hide the tab bar for the same reason. Require the viewport to have actually
  // moved or shrunk as well, so a hardware keyboard — a focused field with a
  // still viewport — cannot trip it.
  const viewportDisplaced = offsetTop > 0 || innerHeight - measuredHeight >= keyboardThreshold;
  const keyboardOpen =
    obscuredHeight >= keyboardThreshold || (textEntryFocused && viewportDisplaced);
  // Some installed iPhones expose a Visual Viewport that excludes the
  // Home Indicator band while `innerHeight` still reaches the paintable
  // bottom edge. Full-screen surfaces need that stable non-keyboard extent;
  // keyboard-open surfaces must keep following the smaller visual viewport.
  const layoutTop = keyboardOpen ? offsetTop : 0;
  const layoutHeight = keyboardOpen
    ? height
    : Math.max(height, Math.max(1, Math.round(innerHeight)), offsetTop + height);

  return {
    height,
    layoutTop,
    layoutHeight,
    offsetTop,
    keyboardInset: keyboardOpen ? obscuredHeight : 0,
    keyboardOpen,
  };
}

/**
 * Keeps CSS viewport variables aligned with iOS Visual Viewport changes.
 *
 * Mount this once inside the root theme provider. CSS still falls back to
 * dynamic viewport units when Visual Viewport is unavailable or before the
 * first client effect.
 */
export function NativeViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    let animationFrame = 0;

    const applyMetrics = () => {
      const viewport = window.visualViewport;
      const metrics = calculateNativeViewportMetrics({
        innerHeight: window.innerHeight,
        viewportHeight: viewport?.height ?? window.innerHeight,
        viewportOffsetTop: viewport?.offsetTop ?? 0,
        textEntryFocused: document.querySelector(TEXT_ENTRY_FOCUS_SELECTOR) !== null,
      });
      root.style.setProperty("--sk-viewport-height", `${String(metrics.height)}px`);
      root.style.setProperty("--sk-layout-viewport-top", `${String(metrics.layoutTop)}px`);
      root.style.setProperty("--sk-layout-viewport-height", `${String(metrics.layoutHeight)}px`);
      root.style.setProperty("--sk-viewport-offset-top", `${String(metrics.offsetTop)}px`);
      root.style.setProperty("--sk-keyboard-inset", `${String(metrics.keyboardInset)}px`);
      body.dataset.skKeyboard = metrics.keyboardOpen ? "open" : "closed";
    };

    const scheduleMetrics = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(applyMetrics);
    };

    applyMetrics();
    // Focus is part of the measurement now, so a field gaining or losing it has
    // to resample just like a viewport change.
    document.addEventListener("focusin", scheduleMetrics, { passive: true });
    document.addEventListener("focusout", scheduleMetrics, { passive: true });
    window.addEventListener("resize", scheduleMetrics, { passive: true });
    window.addEventListener("orientationchange", scheduleMetrics, {
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", scheduleMetrics, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", scheduleMetrics, {
      passive: true,
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("focusin", scheduleMetrics);
      document.removeEventListener("focusout", scheduleMetrics);
      window.removeEventListener("resize", scheduleMetrics);
      window.removeEventListener("orientationchange", scheduleMetrics);
      window.visualViewport?.removeEventListener("resize", scheduleMetrics);
      window.visualViewport?.removeEventListener("scroll", scheduleMetrics);
      root.style.removeProperty("--sk-viewport-height");
      root.style.removeProperty("--sk-layout-viewport-top");
      root.style.removeProperty("--sk-layout-viewport-height");
      root.style.removeProperty("--sk-viewport-offset-top");
      root.style.removeProperty("--sk-keyboard-inset");
      delete body.dataset.skKeyboard;
    };
  }, []);

  return null;
}
