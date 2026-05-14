import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Field surface — locked design system (v3-ui-design).
//
// `bg-elevated` (#FFFFFF) field on the warm-cream canvas. `border-subtle`
// hairline that strengthens on hover. Focus paints an amber ring — same
// `--brand-primary` token as the keyboard `:focus-visible` outline so
// click-focus and tab-focus look consistent.
const fieldBase = [
  "block w-full rounded-[var(--radius-md)]",
  "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
  "px-3 py-2 text-[13px] text-[rgb(var(--fg-default))]",
  "placeholder:text-[rgb(var(--fg-muted))]",
  "transition-colors duration-150",
  "hover:border-[rgb(var(--border-strong))]",
  "focus:outline-none focus:border-[rgb(var(--brand-primary))] focus:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.15)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
].join(" ");

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, "h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          fieldBase,
          "h-10 appearance-none pr-9",
          "[&>option]:bg-[rgb(var(--bg-elevated))] [&>option]:text-[rgb(var(--fg-default))]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--fg-secondary))]"
        fill="currentColor"
      >
        <path d="M5.25 7.5l4.75 4.75L14.75 7.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ),
);
Select.displayName = "Select";

// Label — uppercase micro-label per `.label-tiny` in globals.css. The
// `--fg-muted` colour matches the design-system.md "section labels"
// spec (10–11px, bold, tracking-widest).
const Label = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]",
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export { Input, Textarea, Select, Label };
