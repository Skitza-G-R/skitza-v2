"use client";

import { useEffect } from "react";

interface ViewportMeasurement {
  innerHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
}

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
}: ViewportMeasurement): NativeViewportMetrics {
  const measuredHeight = viewportHeight > 0 ? viewportHeight : innerHeight;
  const height = Math.max(1, Math.round(measuredHeight));
  const offsetTop = Math.max(0, Math.round(viewportOffsetTop));
  const obscuredHeight = Math.max(0, Math.round(innerHeight - measuredHeight - viewportOffsetTop));
  const keyboardThreshold = Math.min(200, Math.max(120, innerHeight * 0.18));
  const keyboardOpen = obscuredHeight >= keyboardThreshold;
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
