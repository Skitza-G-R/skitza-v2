"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { Button, type ButtonProps } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { cn } from "~/lib/cn";

export type NativeKeyboard =
  | "text"
  | "email"
  | "telephone"
  | "url"
  | "search"
  | "numeric"
  | "decimal";

interface NativeKeyboardProps {
  type: InputHTMLAttributes<HTMLInputElement>["type"];
  inputMode: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoCapitalize?: InputHTMLAttributes<HTMLInputElement>["autoCapitalize"];
  autoCorrect?: InputHTMLAttributes<HTMLInputElement>["autoCorrect"];
}

export function resolveNativeKeyboardProps(keyboard: NativeKeyboard): NativeKeyboardProps {
  switch (keyboard) {
    case "email":
      return {
        type: "email",
        inputMode: "email",
        autoCapitalize: "none",
        autoCorrect: "off",
      };
    case "telephone":
      return { type: "tel", inputMode: "tel" };
    case "url":
      return {
        type: "url",
        inputMode: "url",
        autoCapitalize: "none",
        autoCorrect: "off",
      };
    case "search":
      return { type: "search", inputMode: "search" };
    case "numeric":
      return { type: "text", inputMode: "numeric" };
    case "decimal":
      return { type: "text", inputMode: "decimal" };
    default:
      return { type: "text", inputMode: "text" };
  }
}

/**
 * Text-capable native action. Its height can grow when text is enlarged,
 * unlike the fixed-height desktop Button sizes.
 */
export const NativeAction = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn(
        "sk-native-action h-auto min-h-11 rounded-[var(--radius-lg)] px-4 py-2.5 text-center leading-snug whitespace-normal",
        className,
      )}
      {...props}
    />
  ),
);
NativeAction.displayName = "NativeAction";

interface NativeIconActionProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  "aria-label": string;
}

/**
 * Circular icon-only action. A label is required by the public type and the
 * rendered target is always at least 44×44px.
 */
export const NativeIconAction = forwardRef<HTMLButtonElement, NativeIconActionProps>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "sk-press inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full",
        "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]",
        "focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  ),
);
NativeIconAction.displayName = "NativeIconAction";

interface NativeInputProps extends InputHTMLAttributes<HTMLInputElement> {
  keyboard?: NativeKeyboard;
}

export const NativeInput = forwardRef<HTMLInputElement, NativeInputProps>(
  (
    { className, keyboard = "text", type, inputMode, autoCapitalize, autoCorrect, ...props },
    ref,
  ) => {
    const defaults = resolveNativeKeyboardProps(keyboard);

    return (
      <Input
        ref={ref}
        type={type ?? defaults.type}
        inputMode={inputMode ?? defaults.inputMode}
        autoCapitalize={autoCapitalize ?? defaults.autoCapitalize}
        autoCorrect={autoCorrect ?? defaults.autoCorrect}
        className={cn(
          "sk-native-field h-auto rounded-[var(--radius-lg)] text-base leading-snug",
          className,
        )}
        data-native-input={keyboard}
        {...props}
      />
    );
  },
);
NativeInput.displayName = "NativeInput";

export const NativeTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <Textarea
    ref={ref}
    className={cn("sk-native-field min-h-24 resize-y text-base", className)}
    data-native-input="textarea"
    {...props}
  />
));
NativeTextarea.displayName = "NativeTextarea";

interface NativeActionDockProps extends HTMLAttributes<HTMLElement> {
  position?: "sticky" | "fixed";
}

/**
 * Keyboard-aware action row for forms and flows. Fixed docks follow the
 * Visual Viewport keyboard inset; sticky is the safer default for embedded
 * screens.
 */
export const NativeActionDock = forwardRef<HTMLElement, NativeActionDockProps>(
  ({ className, position = "sticky", ...props }, ref) => (
    <footer
      ref={ref}
      data-position={position}
      className={cn(
        "sk-native-action-dock z-30 flex min-w-0 flex-wrap items-center gap-2",
        "border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] pt-3 backdrop-blur-lg",
        position === "sticky" && "sticky",
        position === "fixed" && "fixed inset-x-0",
        className,
      )}
      {...props}
    />
  ),
);
NativeActionDock.displayName = "NativeActionDock";
