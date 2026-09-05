"use client";

import { useEffect, useState } from "react";

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
  const [guard, setGuard] = useState(false);

  useArticleScrollGuard(guard);

  useEffect(() => {
    const sample = () => {
      setLines(readMetrics());
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
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] px-1 pt-1">
      <pre className="pointer-events-auto m-0 overflow-x-auto rounded bg-black/85 p-1.5 font-mono text-[9px] leading-[1.35] whitespace-pre text-lime-300">
        {lines.join("\n")}
      </pre>
      <button
        type="button"
        data-sim="toggle-article-guard"
        onClick={() => {
          setGuard((current) => !current);
        }}
        className="pointer-events-auto mt-1 rounded bg-black/85 px-2 py-1 font-mono text-[10px] font-bold text-lime-300"
      >
        shell scroll guard: {guard ? "ON" : "off"}
      </button>
    </div>
  );
}
