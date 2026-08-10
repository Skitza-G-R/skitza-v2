"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";

import { cn } from "~/lib/cn";

const ROW_HEIGHT_PX = 48;
const SCROLL_SETTLE_MS = 120;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type CenteredWheelPickerOption = Readonly<{
  value: string;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: boolean;
}>;

export type CenteredWheelPickerProps = Readonly<{
  label: string;
  options: readonly CenteredWheelPickerOption[];
  value?: string | null;
  onValueChange: (value: string) => void;
  visibleRows?: 3 | 5;
  id?: string;
  disabled?: boolean;
  ariaDescribedBy?: string;
  emptyMessage?: string;
  emphasis?: "compact" | "prominent";
  className?: string;
}>;

type Direction = -1 | 1;

/**
 * A compact, touch-friendly wheel for short lists such as dates and times.
 *
 * The centered option is the active option. Pointer scrolling selects after
 * scroll snap settles, while keyboard navigation follows the single-select
 * listbox pattern and skips disabled values.
 */
export function CenteredWheelPicker({
  label,
  options,
  value = null,
  onValueChange,
  visibleRows = 5,
  id,
  disabled = false,
  ariaDescribedBy,
  emptyMessage = "No options available",
  emphasis = "compact",
  className,
}: CenteredWheelPickerProps) {
  const generatedId = useId().replaceAll(":", "");
  const wheelId = id ?? `centered-wheel-${generatedId}`;
  const labelId = `${wheelId}-label`;
  const height = visibleRows * ROW_HEIGHT_PX;
  const centerOffset = ((visibleRows - 1) / 2) * ROW_HEIGHT_PX;
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollTopRef = useRef(0);
  const scrollDirectionRef = useRef<Direction>(1);
  const syncedIndexRef = useRef(-2);
  const latestValueRef = useRef<string | null>(value);

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const firstEnabledIndex = useMemo(
    () => options.findIndex((option) => !option.disabled),
    [options],
  );
  const preferredIndex =
    selectedIndex >= 0
      ? selectedIndex
      : firstEnabledIndex >= 0
        ? firstEnabledIndex
        : options[0]
          ? 0
          : -1;
  const [activeIndex, setActiveIndex] = useState(preferredIndex);
  const resolvedActiveIndex = options[activeIndex] ? activeIndex : preferredIndex;
  const activeOptionId =
    resolvedActiveIndex >= 0 ? `${wheelId}-option-${String(resolvedActiveIndex)}` : undefined;

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (syncedIndexRef.current === preferredIndex) return;
    syncedIndexRef.current = preferredIndex;
    setActiveIndex(preferredIndex);
    if (preferredIndex < 0 || !listRef.current) return;
    const top = preferredIndex * ROW_HEIGHT_PX;
    listRef.current.scrollTop = top;
    lastScrollTopRef.current = top;
  }, [preferredIndex]);

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const scrollToIndex = useCallback((index: number) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * ROW_HEIGHT_PX;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top, behavior });
    } else {
      list.scrollTop = top;
    }
  }, []);

  const commitIndex = useCallback(
    (index: number, shouldScroll: boolean) => {
      const option = options[index];
      if (!option || option.disabled || disabled) return;
      syncedIndexRef.current = index;
      setActiveIndex(index);
      if (shouldScroll) scrollToIndex(index);
      if (latestValueRef.current === option.value) return;
      latestValueRef.current = option.value;
      onValueChange(option.value);
    },
    [disabled, onValueChange, options, scrollToIndex],
  );

  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    if (disabled || options.length === 0) return;
    const list = event.currentTarget;
    const nextTop = list.scrollTop;
    if (nextTop !== lastScrollTopRef.current) {
      scrollDirectionRef.current = nextTop > lastScrollTopRef.current ? 1 : -1;
    }
    lastScrollTopRef.current = nextTop;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const rawIndex = clamp(Math.round(list.scrollTop / ROW_HEIGHT_PX), 0, options.length - 1);
      const nextIndex = nearestEnabledIndex(options, rawIndex, scrollDirectionRef.current);
      if (nextIndex >= 0) commitIndex(nextIndex, nextIndex !== rawIndex);
    }, SCROLL_SETTLE_MS);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || options.length === 0) return;
    const current = resolvedActiveIndex;
    let nextIndex = -1;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = nextEnabledIndex(options, current, 1);
        break;
      case "ArrowUp":
        nextIndex = nextEnabledIndex(options, current, -1);
        break;
      case "Home":
        nextIndex = firstEnabledOptionIndex(options);
        break;
      case "End":
        nextIndex = lastEnabledOptionIndex(options);
        break;
      case "PageDown":
        nextIndex = pageEnabledIndex(options, current, visibleRows, 1);
        break;
      case "PageUp":
        nextIndex = pageEnabledIndex(options, current, visibleRows, -1);
        break;
      case "Enter":
      case " ":
      case "Spacebar":
        event.preventDefault();
        if (current >= 0) commitIndex(current, true);
        return;
      default:
        return;
    }

    event.preventDefault();
    if (nextIndex >= 0) commitIndex(nextIndex, true);
  }

  return (
    <div className={cn("w-full min-w-0", className)}>
      <span
        id={labelId}
        className="mb-2 block text-center text-sm font-semibold text-[rgb(var(--fg-default))]"
      >
        {label}
      </span>
      <div
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))]"
        style={{ height }}
      >
        <div
          aria-hidden
          data-testid="centered-wheel-center-band"
          className="pointer-events-none absolute inset-x-2 z-0 rounded-[var(--radius-md)] border-y border-[rgb(var(--brand-primary)/0.42)] bg-[rgb(var(--brand-primary)/0.09)]"
          style={{ top: centerOffset, height: ROW_HEIGHT_PX }}
        />
        <div
          ref={listRef}
          id={wheelId}
          role="listbox"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-describedby={ariaDescribedBy}
          aria-orientation="vertical"
          aria-activedescendant={activeOptionId}
          aria-disabled={disabled || undefined}
          data-emphasis={emphasis}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          className={cn(
            "relative z-10 w-full touch-pan-y snap-y snap-mandatory overflow-y-auto overscroll-contain text-center select-none",
            "scroll-smooth [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden",
            "focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset",
            disabled && "cursor-not-allowed opacity-55",
          )}
          style={{ height, scrollSnapType: "y mandatory" }}
        >
          <div role="presentation" aria-hidden style={{ height: centerOffset }} />
          {options.length === 0 ? (
            <div
              role="presentation"
              className="flex items-center justify-center px-3 text-center text-sm text-[rgb(var(--fg-muted))]"
              style={{ height: ROW_HEIGHT_PX, minHeight: ROW_HEIGHT_PX }}
            >
              {emptyMessage}
            </div>
          ) : (
            options.map((option, index) => {
              const selected = option.value === value;
              const active = index === resolvedActiveIndex;
              return (
                <div
                  key={option.value}
                  id={`${wheelId}-option-${String(index)}`}
                  role="option"
                  aria-label={option.ariaLabel}
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  data-active={active ? "true" : "false"}
                  data-selected={selected ? "true" : "false"}
                  data-disabled={option.disabled ? "true" : "false"}
                  onClick={() => {
                    if (option.disabled || disabled) return;
                    focusWithoutScrolling(listRef.current);
                    commitIndex(index, true);
                  }}
                  className={cn(
                    "relative flex w-full snap-center items-center justify-center text-center transition-[color,opacity,font-size,font-weight] duration-150 motion-reduce:transition-none",
                    emphasis === "prominent" ? "px-1 text-sm" : "px-3 text-sm",
                    option.disabled && !option.placeholder
                      ? "cursor-not-allowed text-[rgb(var(--fg-faint))] opacity-45"
                      : option.placeholder
                        ? "cursor-not-allowed text-[rgb(var(--fg-muted))]"
                        : "cursor-pointer text-[rgb(var(--fg-secondary))]",
                    active &&
                      !option.disabled &&
                      cn(
                        "font-bold text-[rgb(var(--fg-default))]",
                        emphasis === "prominent" &&
                          "text-[17px] leading-none tracking-[-0.025em] sm:text-lg",
                      ),
                    active && option.placeholder && "font-semibold text-[rgb(var(--fg-muted))]",
                  )}
                  style={{
                    height: ROW_HEIGHT_PX,
                    minHeight: ROW_HEIGHT_PX,
                    scrollSnapAlign: "center",
                  }}
                >
                  <span className="block w-full truncate text-center">{option.label}</span>
                </div>
              );
            })
          )}
          <div role="presentation" aria-hidden style={{ height: centerOffset }} />
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function firstEnabledOptionIndex(options: readonly CenteredWheelPickerOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabledOptionIndex(options: readonly CenteredWheelPickerOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function nextEnabledIndex(
  options: readonly CenteredWheelPickerOption[],
  current: number,
  direction: Direction,
): number {
  for (let index = current + direction; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function pageEnabledIndex(
  options: readonly CenteredWheelPickerOption[],
  current: number,
  pageSize: number,
  direction: Direction,
): number {
  if (options.length === 0) return -1;
  const anchor = current >= 0 ? current : direction === 1 ? -1 : options.length;
  const target = clamp(anchor + direction * pageSize, 0, options.length - 1);
  return nearestEnabledIndex(options, target, direction);
}

function nearestEnabledIndex(
  options: readonly CenteredWheelPickerOption[],
  target: number,
  direction: Direction,
): number {
  if (options.length === 0) return -1;
  const boundedTarget = clamp(target, 0, options.length - 1);
  if (!options[boundedTarget]?.disabled) return boundedTarget;

  for (let distance = 1; distance < options.length; distance += 1) {
    const preferred = boundedTarget + distance * direction;
    if (preferred >= 0 && preferred < options.length && !options[preferred]?.disabled) {
      return preferred;
    }
    const fallback = boundedTarget - distance * direction;
    if (fallback >= 0 && fallback < options.length && !options[fallback]?.disabled) {
      return fallback;
    }
  }
  return -1;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function focusWithoutScrolling(element: HTMLElement | null): void {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}
