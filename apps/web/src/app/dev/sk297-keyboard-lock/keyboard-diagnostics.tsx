"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reads every number that could explain a full-screen surface moving when the
 * software keyboard opens. A desktop browser cannot reproduce the iOS
 * behaviour, so this exists to be photographed on a real phone: whichever of
 * these values is wrong names the mechanism.
 */
function readMetrics(): string[] {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim() || "—";
  const scrollingElement = document.scrollingElement;
  const article = document.querySelector<HTMLElement>('[role="dialog"]');
  const scroller = document.querySelector<HTMLElement>(".sk-native-scroll");
  const dock = document.querySelector<HTMLElement>(".sk-native-action-dock");
  const bodyStyle = getComputedStyle(document.body);
  const round = (value: number) => String(Math.round(value));
  const box = (element: HTMLElement | null) => {
    if (!element) return "absent";
    const rect = element.getBoundingClientRect();
    return `top ${round(rect.top)} h ${round(rect.height)} scrollTop ${round(element.scrollTop)} scrollH ${round(element.scrollHeight)} clientH ${round(element.clientHeight)}`;
  };
  const focused = document.activeElement;
  const focusedLabel =
    focused && focused !== document.body
      ? `${focused.tagName.toLowerCase()}#${focused.id || "—"} top ${round(focused.getBoundingClientRect().top)}`
      : "none";

  return [
    `standalone ${String(window.matchMedia("(display-mode: standalone)").matches)}  kbd ${document.body.dataset.skKeyboard ?? "—"}`,
    `innerHeight ${round(window.innerHeight)}  scrollY ${round(window.scrollY)}  docScrollTop ${round(scrollingElement?.scrollTop ?? 0)}`,
    `vv.height ${round(viewport?.height ?? 0)}  vv.offsetTop ${round(viewport?.offsetTop ?? 0)}  vv.pageTop ${round(viewport?.pageTop ?? 0)}`,
    `--vp-height ${cssVar("--sk-viewport-height")}  --offset-top ${cssVar("--sk-viewport-offset-top")}  --kbd-inset ${cssVar("--sk-keyboard-inset")}`,
    `body ${bodyStyle.position} top ${bodyStyle.top}`,
    `article  ${box(article)}`,
    `scroller ${box(scroller)}`,
    `dock     ${box(dock)}`,
    `focused  ${focusedLabel}`,
  ];
}

/**
 * A phone screenshot is one instant, and iOS settles the viewport quickly after
 * a field is focused. Remembering the sample with the largest
 * `visualViewport.offsetTop` means the photograph still carries the moment the
 * surface was furthest out of place, whenever it is taken.
 */
function readPeakCandidate() {
  const viewport = window.visualViewport;
  const offsetTop = Math.round(viewport?.offsetTop ?? 0);
  const root = document.documentElement;
  const cssVar = (name: string) => getComputedStyle(root).getPropertyValue(name).trim() || "—";
  const article = document.querySelector<HTMLElement>('[role="dialog"]');
  const round = (value: number) => String(Math.round(value));
  const articleLabel = article
    ? `article top ${round(article.getBoundingClientRect().top)} scrollTop ${round(article.scrollTop)}`
    : "article absent";
  return {
    offsetTop,
    line:
      `PEAK vv.offsetTop ${String(offsetTop)}  kbd ${document.body.dataset.skKeyboard ?? "—"}\n` +
      `  vv.h ${round(viewport?.height ?? 0)}  --off ${cssVar("--sk-viewport-offset-top")}  --kbd ${cssVar("--sk-keyboard-inset")}  ${articleLabel}`,
  };
}

/**
 * When `guard` is on, any scroll of the `overflow: hidden` editor shell is
 * undone. iOS will scroll such a box to reveal a focused field even though the
 * user never can, which pushes the header and step nav off the top — the
 * symptom in the report. If switching this on makes the screen behave, that is
 * the mechanism.
 */
function useArticleScrollGuard(guard: boolean) {
  useEffect(() => {
    if (!guard) return;
    const article = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!article) return;
    const pin = () => {
      if (article.scrollTop !== 0) article.scrollTop = 0;
      if (article.scrollLeft !== 0) article.scrollLeft = 0;
    };
    article.addEventListener("scroll", pin, { passive: true });
    const timer = window.setInterval(pin, 100);
    return () => {
      article.removeEventListener("scroll", pin);
      window.clearInterval(timer);
    };
  }, [guard]);
}

export function KeyboardDiagnostics() {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [peak, setPeak] = useState<string>("PEAK vv.offsetTop 0");
  const [offsetTop, setOffsetTop] = useState(0);
  const [guard, setGuard] = useState(false);
  const peakOffsetRef = useRef(-1);

  useArticleScrollGuard(guard);

  useEffect(() => {
    const sample = () => {
      setLines(readMetrics());
      const candidate = readPeakCandidate();
      // `position: fixed` resolves against the layout viewport, so this panel
      // would be pushed off the top by exactly the offset it exists to report.
      // Translating by the offset keeps it inside the visual viewport — and
      // keeps the guard switch tappable — whatever iOS does to the page.
      setOffsetTop(candidate.offsetTop);
      if (candidate.offsetTop > peakOffsetRef.current) {
        peakOffsetRef.current = candidate.offsetTop;
        setPeak(candidate.line);
      }
    };
    sample();
    const timer = window.setInterval(sample, 200);
    window.visualViewport?.addEventListener("resize", sample);
    window.visualViewport?.addEventListener("scroll", sample);
    return () => {
      window.clearInterval(timer);
      window.visualViewport?.removeEventListener("resize", sample);
      window.visualViewport?.removeEventListener("scroll", sample);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] px-1 pt-1"
      style={{ transform: `translate3d(0, ${String(offsetTop)}px, 0)` }}
    >
      <pre className="pointer-events-auto m-0 overflow-x-auto rounded bg-black/90 p-1.5 font-mono text-[10px] leading-[1.35] whitespace-pre text-lime-300">
        {[...lines, peak].join("\n")}
      </pre>
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          data-sim="toggle-article-guard"
          onClick={() => {
            setGuard((current) => !current);
          }}
          className="pointer-events-auto rounded bg-black/90 px-2 py-1 font-mono text-[11px] font-bold text-lime-300"
        >
          shell scroll guard: {guard ? "ON" : "off"}
        </button>
        <button
          type="button"
          data-sim="reset-peak"
          onClick={() => {
            peakOffsetRef.current = -1;
            setPeak("PEAK vv.offsetTop 0");
          }}
          className="pointer-events-auto rounded bg-black/90 px-2 py-1 font-mono text-[11px] font-bold text-lime-300"
        >
          reset peak
        </button>
      </div>
    </div>
  );
}
