"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
} from "react";

import { NativeIconAction } from "~/components/native/native-actions";
import { useSwipeBack } from "~/components/native/use-native-navigation";
import { cn } from "~/lib/cn";

export type NativeFlowDirection = "forward" | "back";

const NativeFullScreenFlow = DialogPrimitive.Root;
const NativeFullScreenFlowTrigger = DialogPrimitive.Trigger;
const NativeFullScreenFlowClose = DialogPrimitive.Close;

interface NativeFullScreenFlowContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  direction?: NativeFlowDirection;
  onBack?: () => void;
  swipeBack?: boolean;
}

export const NativeFullScreenFlowContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  NativeFullScreenFlowContentProps
>(
  (
    {
      className,
      direction = "forward",
      onBack,
      swipeBack = true,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      ...props
    },
    ref,
  ) => {
    const swipeHandlers = useSwipeBack({
      onBack: onBack ?? (() => undefined),
      enabled: swipeBack && onBack != null,
    });

    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[70] bg-[rgb(var(--bg-sidebar)/0.42)] backdrop-blur-sm",
            "data-[state=open]:animate-[skitza-reveal-up_180ms_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none",
          )}
        />
        <DialogPrimitive.Content
          ref={ref}
          data-direction={direction}
          data-native-full-screen-flow=""
          className={cn(
            "sk-native-full-screen-flow sk-native-flow-motion fixed inset-x-0 z-[71] flex w-full flex-col overflow-hidden",
            "bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-default))] shadow-[var(--shadow-lg)] focus:outline-none",
            "md:inset-x-4 md:top-[calc(var(--sk-viewport-offset-top,0px)+1rem)] md:mx-auto md:h-[calc(var(--sk-viewport-height,100dvh)-2rem)] md:max-h-[calc(var(--sk-viewport-height,100dvh)-2rem)] md:max-w-3xl md:rounded-[var(--radius-xl)] md:border md:border-[rgb(var(--border-subtle))]",
            className,
          )}
          onPointerDown={composePointerHandler(onPointerDown, swipeHandlers.onPointerDown)}
          onPointerUp={composePointerHandler(onPointerUp, swipeHandlers.onPointerUp)}
          onPointerCancel={composePointerHandler(onPointerCancel, swipeHandlers.onPointerCancel)}
          {...props}
        />
      </DialogPrimitive.Portal>
    );
  },
);
NativeFullScreenFlowContent.displayName = "NativeFullScreenFlowContent";

interface NativeFullScreenFlowHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  action?: ReactNode;
}

export const NativeFullScreenFlowHeader = forwardRef<HTMLElement, NativeFullScreenFlowHeaderProps>(
  ({ title, description, onBack, backLabel = "Back", action, className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn(
        "flex min-w-0 shrink-0 items-start gap-3 border-b border-[rgb(var(--border-subtle))]",
        "px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    >
      {onBack ? (
        <NativeIconAction aria-label={backLabel} onClick={onBack} className="-my-1">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </NativeIconAction>
      ) : null}
      <div className="min-w-0 flex-1 pt-1">
        <DialogPrimitive.Title className="font-display text-lg leading-tight font-bold tracking-tight break-words">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 text-sm leading-snug break-words text-[rgb(var(--fg-muted))]">
          {description}
        </DialogPrimitive.Description>
      </div>
      {action ? <div className="min-w-0 shrink-0">{action}</div> : null}
    </header>
  ),
);
NativeFullScreenFlowHeader.displayName = "NativeFullScreenFlowHeader";

export const NativeFullScreenFlowBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("sk-native-scroll min-w-0 flex-1 px-4 py-5 sm:px-5", className)}
      {...props}
    />
  ),
);
NativeFullScreenFlowBody.displayName = "NativeFullScreenFlowBody";

export const NativeFullScreenFlowFooter = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <footer
      ref={ref}
      className={cn(
        "sk-native-action-dock z-10 flex min-w-0 shrink-0 flex-wrap items-center gap-2",
        "border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.96)] pt-3 backdrop-blur-lg",
        className,
      )}
      {...props}
    />
  ),
);
NativeFullScreenFlowFooter.displayName = "NativeFullScreenFlowFooter";

function composePointerHandler(
  consumer: PointerEventHandler<HTMLElement> | undefined,
  native: PointerEventHandler<HTMLElement>,
): PointerEventHandler<HTMLElement> {
  return (event) => {
    consumer?.(event);
    if (!event.defaultPrevented) native(event);
  };
}

export { NativeFullScreenFlow, NativeFullScreenFlowClose, NativeFullScreenFlowTrigger };
