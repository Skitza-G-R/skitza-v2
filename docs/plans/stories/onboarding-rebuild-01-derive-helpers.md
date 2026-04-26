# Story 01 — Derive helpers (slug + currency)

> Skitza-BMAD · Story 01 of 10 for `feat/onboarding-rebuild`
> Architecture: `docs/plans/active/2026-04-25-onboarding-rebuild-architecture.md` §4.1
> PRD: §4.5 (commit `889b6a7`)
> **Depends on:** none — this is the foundation

---

## As a Skitza producer signing up...

I want my studio slug and default currency to be silently and correctly derived from what I type and where I am, so I never have to think about either during onboarding.

## Acceptance criteria

- [ ] `slugFromDisplayName("DJ Smith", "8f2a")` returns `"dj-smith-8f2a"`.
- [ ] `slugFromDisplayName("  El Café   ", "0001")` returns `"el-cafe-0001"` (trim, lowercase, ASCII-fold or strip).
- [ ] `slugFromDisplayName("////", "abcd")` returns `"studio-abcd"` (fallback when displayName has no allowed chars).
- [ ] Result always matches `/^[a-z0-9-]{3,48}$/`.
- [ ] Result is deterministic given (displayName, hash).
- [ ] Length never exceeds 48 chars: long names truncated BEFORE the `-hash` suffix is appended (so the hash always stays at the tail).
- [ ] `currencyFromCountry("US")` → `"USD"`; `"GB"` / `"UK"` → `"GBP"`; `"IL"` → `"ILS"`; `"DE"` / `"FR"` / `"NL"` / any EU member → `"EUR"`; `"CA"` / `"AU"` / `"NZ"` → `"USD"` (per PRD); `"JP"` / `"CN"` / `"BR"` / `null` / `undefined` / `""` → `"USD"`.
- [ ] All tests use vitest, no DB, no I/O. Run in <100 ms.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/lib/onboarding/derive.ts` — pure functions `slugFromDisplayName` + `currencyFromCountry` + the EU member-state Set.
- `apps/web/src/lib/onboarding/derive.test.ts` — vitest unit tests.

**Modify:** none.

### Type signatures

```ts
export function slugFromDisplayName(displayName: string, randomHex4: string): string;

export type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";
export function currencyFromCountry(country: string | null | undefined): SupportedCurrency;
```

### EU member set

Use the official 27-member list as of 2026: `AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE`. Source: hard-coded `Set<string>`. Test asserts ~5 of these explicitly.

### Conventions (CLAUDE.md)

- Pure functions only. No `Date.now()`, no `Math.random()`, no I/O. Hash is passed in as a parameter so tests stay deterministic.
- Tests live next to code as `derive.test.ts`.
- No new types beyond `SupportedCurrency` (re-exported by callers as needed).

## TDD steps

### Step 1 — Write failing tests

```ts
// apps/web/src/lib/onboarding/derive.test.ts
import { describe, expect, it } from "vitest";
import { slugFromDisplayName, currencyFromCountry } from "./derive";

describe("slugFromDisplayName", () => {
  it("lowercases and dash-separates", () => {
    expect(slugFromDisplayName("DJ Smith", "8f2a")).toBe("dj-smith-8f2a");
  });

  it("strips diacritics + non-ASCII", () => {
    expect(slugFromDisplayName("  El Café   ", "0001")).toBe("el-cafe-0001");
  });

  it("falls back to 'studio' when displayName collapses to empty", () => {
    expect(slugFromDisplayName("////", "abcd")).toBe("studio-abcd");
  });

  it("collapses multiple separators", () => {
    expect(slugFromDisplayName("Foo  -- Bar!!", "1234")).toBe("foo-bar-1234");
  });

  it("truncates the body so total ≤ 48 chars", () => {
    const name = "A".repeat(60);
    const out = slugFromDisplayName(name, "ffff");
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith("-ffff")).toBe(true);
  });

  it("matches the slug regex", () => {
    const out = slugFromDisplayName("DJ Smith", "8f2a");
    expect(out).toMatch(/^[a-z0-9-]{3,48}$/);
  });
});

describe("currencyFromCountry", () => {
  it.each([
    ["US", "USD"], ["CA", "USD"], ["AU", "USD"], ["NZ", "USD"],
    ["GB", "GBP"], ["UK", "GBP"],
    ["IL", "ILS"],
    ["DE", "EUR"], ["FR", "EUR"], ["NL", "EUR"], ["IE", "EUR"], ["ES", "EUR"],
    ["JP", "USD"], ["CN", "USD"], ["BR", "USD"],
  ])("maps %s → %s", (country, expected) => {
    expect(currencyFromCountry(country)).toBe(expected);
  });

  it("falls back to USD on null/undefined/empty", () => {
    expect(currencyFromCountry(null)).toBe("USD");
    expect(currencyFromCountry(undefined)).toBe("USD");
    expect(currencyFromCountry("")).toBe("USD");
  });
});
```

Expected on first run: FAIL with module-resolve error (file doesn't exist yet).

### Step 2 — Verify RED

```bash
cd apps/web && pnpm test src/lib/onboarding/derive.test.ts
```

Capture verbatim error output. (It should be: cannot resolve `./derive`.)

### Step 3 — Implement

Minimal implementation in `derive.ts`:
- `slugFromDisplayName`: trim → lowercase → `normalize("NFKD").replace(/[̀-ͯ]/g, "")` to ASCII-fold → replace non-`[a-z0-9]+` with `-` → collapse repeated `-` → strip leading/trailing `-` → fallback to `"studio"` if empty → truncate body to `48 - 5` (= 43, leaves room for `-` + 4-char hash) → return `${body}-${randomHex4}`.
- `currencyFromCountry`: uppercase input → switch on supported → otherwise check EU set → fallback to USD.

### Step 4 — Verify GREEN

```bash
cd apps/web && pnpm test src/lib/onboarding/derive.test.ts
```

Expected: 14 passing, 0 failing.

### Step 5 — Full pipeline

```bash
cd /Users/giliasraf/Skitza\ 16.4 && pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test
```

Expected: green across the board. New: 14 tests in `derive.test.ts`. No deltas elsewhere.

## Commit

```bash
git add apps/web/src/lib/onboarding/
git commit -m "$(cat <<'EOF'
feat(onboarding): pure helpers — slugFromDisplayName + currencyFromCountry

Foundation for the 4-step onboarding rebuild (PRD §4.5, arch §4.1).
Both helpers are pure (no I/O, no globals) so the wizard's server
action stays deterministic + testable. Slug is guaranteed to differ
from emailToSlug(email), so submitting Step 1 alone marks the producer
"complete" by the existing role-resolution rule — making Steps 2-4
safely skippable.

Currency map covers the 4 supported codes (USD/EUR/GBP/ILS) with a USD
fallback for unsupported countries (CA/AU/NZ default to USD because
their native currencies aren't in the supported enum yet).

Story 01 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] All 14 acceptance-criteria assertions covered by tests
- [ ] No types invented beyond `SupportedCurrency`
- [ ] No new deps added
- [ ] Functions exported with exact signatures specified

### Code quality

- [ ] Pure (no `Date.now`, `Math.random`, no module-level state)
- [ ] EU set is `Set<string>` (O(1) membership), not array
- [ ] Tests fit on one screen per `describe` — readable

## Report format

1. Files changed
2. RED output verbatim
3. GREEN output verbatim
4. `/skitza-verify` tail
5. Commit SHA
6. Deviations + rationale
7. Follow-ups (e.g. "consider adding CAD when we expand the supported enum")
