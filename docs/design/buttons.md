# Button shape — Skitza design system

> **Status:** Locked 2026-05-16 by Gili.
> **Owner:** Gili.

## The rule

Every rectangular text element in Skitza — buttons, CTAs, filter chips, status badges, tabs, dropdown triggers — uses a **rounded rectangle** with a radius that **scales with the element's height** so every button reads with the same "rounded rectangle" feel, not a pill.

Skitza does **not** use full pill shape (`rounded-full`) on any rectangle with text. `rounded-full` is reserved for **square** elements only (avatars, icon-only buttons, dots, play buttons, decorative blurs).

## The 3-tier scale

Pick the radius based on the element's rendered height:

| Tier | Height | Class | Token | Visual feel |
|---|---|---|---|---|
| **Small** | h < 36px | `rounded-[var(--radius-sm)]` | 8px | Tight chip / badge |
| **Medium** | 36px ≤ h < 44px | `rounded-[var(--radius-md)]` | 12px | Standard button |
| **Large** | h ≥ 44px | `rounded-[var(--radius-lg)]` | 16px | Primary CTA |

The reference is the "+ New client" CTA on `/dashboard/clients-projects`: a **large** button (~50px tall) with **16px** radius. Every other rectangle should look like that proportionally — radius roughly 30-35% of height.

## How to read button height from Tailwind

Height comes from either an explicit `h-N` class or the combination of `py-*` + `text-*`. Rough conversion:

| Tailwind | Approx height | Use radius |
|---|---|---|
| `h-7` / `py-1 text-[10-12px]` | 24-28px | `--radius-sm` (8px) |
| `h-8` / `py-1.5 text-[11-13px]` | 30-32px | `--radius-sm` (8px) |
| `h-9` / `py-2 text-[12-13px]` | 36-38px | `--radius-md` (12px) |
| `h-10` / `py-2 text-sm` | 40px | `--radius-md` (12px) |
| `h-11` / `py-2.5 text-base` | 44px | `--radius-lg` (16px) |
| `h-12` / `py-3 text-base` | 48px | `--radius-lg` (16px) |
| `h-14` / `py-3 text-lg` | 56px | `--radius-lg` (16px) |

## What NOT to do

- ❌ `rounded-full` on anything with text content (the old pill look — rejected)
- ❌ One-size-fits-all radius (small buttons end up looking pill-y; large buttons end up looking square)
- ❌ `rounded-3xl`, `rounded-2xl`, hardcoded pixel values for text rectangles
- ❌ Mixing `rounded-md` and `rounded-lg` on similar buttons in the same view (use the tier that matches the height)

## Token reference

```css
/* apps/web/src/app/globals.css */
--radius-sm: 8px;   /* small chips, badges, tiny buttons (h < 36) */
--radius-md: 12px;  /* standard buttons, segmented tabs (36-44) */
--radius-lg: 16px;  /* primary CTAs, hero buttons (h ≥ 44) */
--radius-xl: 20px;
--radius-2xl: 28px;
```

The shared `<Button />` component (`apps/web/src/components/ui/button.tsx`) defaults to `--radius-md` (12px) which fits its default `h-10` size — that aligns with the medium tier. Override per-instance with `className="rounded-[var(--radius-lg)]"` when the button is large (`size="lg"` / `size="xl"`), or `rounded-[var(--radius-sm)]` when it's small (`size="sm"`).

## Decision shorthand

- **Is it square (`h-X w-X` matching)?** → `rounded-full` (circle).
- **Does it have text and horizontal padding?** → look at height → pick tier from the table above.
