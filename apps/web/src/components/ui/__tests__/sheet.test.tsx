import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "../sheet";

// Sheet primitive — contract tests.
//
// In-repo testing convention: vitest with `environment: "node"` (no
// jsdom). For Radix-backed primitives whose inner Content only mounts
// when the Root opens via event handlers, we can't render the full
// surface server-side. Instead we test:
//   1. The full shadcn-parity export surface exists (Phase 5 imports
//      compose against named exports — break here = consumer breakage).
//   2. The plain HTMLAttributes-style helpers (Header/Footer) emit the
//      locked design tokens via static markup.
//
// The motion class `.sk-sheet-enter` and its reduce-gate are pinned
// by motion-primitives.test.ts in apps/web/src/app/__tests__/.

describe("Sheet primitive — module exports", () => {
  it("exports the full shadcn-style API surface", () => {
    expect(Sheet).toBeDefined();
    expect(SheetTrigger).toBeDefined();
    expect(SheetPortal).toBeDefined();
    expect(SheetClose).toBeDefined();
    expect(SheetOverlay).toBeDefined();
    expect(SheetContent).toBeDefined();
    expect(SheetHeader).toBeDefined();
    expect(SheetFooter).toBeDefined();
    expect(SheetTitle).toBeDefined();
    expect(SheetDescription).toBeDefined();
  });
});

describe("Sheet primitive — Header / Footer composition", () => {
  it("SheetHeader emits the locked layout tokens", () => {
    const html = renderToStaticMarkup(
      <SheetHeader>
        <span>title</span>
      </SheetHeader>,
    );
    // Vertical stack with tight gap, left-aligned for sheet headers.
    expect(html).toContain("flex");
    expect(html).toContain("flex-col");
    expect(html).toContain("gap-1.5");
    expect(html).toContain("text-left");
    expect(html).toContain("<span>title</span>");
  });

  it("SheetFooter stacks col-reverse on mobile, row-justify-end at sm+", () => {
    const html = renderToStaticMarkup(
      <SheetFooter>
        <span>cta</span>
      </SheetFooter>,
    );
    expect(html).toContain("flex-col-reverse");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("sm:justify-end");
  });

  it("SheetHeader passes className through (twMerge does not duplicate)", () => {
    const html = renderToStaticMarkup(
      <SheetHeader className="px-2 text-center">
        <span>x</span>
      </SheetHeader>,
    );
    expect(html).toContain("px-2");
    // text-center should win over the default text-left via twMerge.
    expect(html).toContain("text-center");
    expect(html).not.toContain("text-left");
  });
});
