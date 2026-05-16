# Button shape — Skitza design system

> **Status:** Locked 2026-05-16 by Gili.
> **Owner:** Gili.

## The rule

Every rectangular text element in Skitza — buttons, CTAs, filter chips, status badges, tabs, dropdown triggers — uses a **rounded rectangle** shape with **16px corner radius** (`--radius-lg`).

Skitza does **not** use full pill shape (`rounded-full`) on any rectangle with text. `rounded-full` is reserved for **square** elements only (avatars, icon-only buttons, dots, play buttons, decorative blurs).

## The reference

The "+ New client" CTA on the Clients & Projects page is the canonical example.

| Element | Shape | Radius | Class |
|---|---|---|---|
| Primary CTA (`+ New client`, `Save`, `Send`) | Rounded rectangle | 16px | `rounded-[var(--radius-lg)]` |
| Row action (`INVITE TO APP`) | Rounded rectangle | 16px | `rounded-[var(--radius-lg)]` |
| Filter chip / tab / status badge / tiny pill | Rounded rectangle | 16px | `rounded-[var(--radius-lg)]` |
| Avatar / icon-only button / dot | Circle | full | `rounded-full` (only because the element is square) |

## How to pick the class

- **Has text? Has horizontal padding (`px-*`) wider than vertical (`py-*`)?** → It's a rectangle. Use `rounded-[var(--radius-lg)]`.
- **Square element (`h-X w-X` where X matches)?** → It's a circle. Use `rounded-full`.

## What NOT to do

- ❌ `rounded-full` on anything with text content (was the old pill look — rejected)
- ❌ `rounded-3xl`, `rounded-2xl`, `rounded-[20px]`, hardcoded pixel values for text rectangles
- ❌ Mixing `rounded-md` and `rounded-lg` on similar buttons in the same view

## Token reference

```css
/* apps/web/src/app/globals.css */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;   /* ← the standard for all rectangle text elements */
--radius-xl: 20px;
--radius-2xl: 28px;
```

The shared `<Button />` component (`apps/web/src/components/ui/button.tsx`) still defaults to `--radius-md` (12px) for compactness on smaller buttons. Override per-instance with `className="rounded-[var(--radius-lg)]"` when the button is a page-level CTA, or update its default if a global pass is done later.
