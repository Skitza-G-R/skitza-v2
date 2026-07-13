import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Characterization tests for the artist Book page (S10). These are
// source-grep tests in the repo's existing style (see
// store-product-client.test.ts / commit-screens.test.ts). They lock the
// REAL backend wiring + behaviour of the live booking page so the S10
// re-skin can change className / markup only, never the state machine,
// the tRPC calls, the a11y roles, the keyboard nav, or the
// request/pending semantics.

const here = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(here, "..", "page.tsx");
const CLIENT_PATH = join(here, "..", "booking-client.tsx");

const pageSrc = readFileSync(PAGE_PATH, "utf8");
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

describe("book/page.tsx server wiring", () => {
  it("resolves the four tRPC reads it depends on", () => {
    expect(pageSrc).toMatch(/caller\.artist\.studios\(\)/);
    expect(pageSrc).toMatch(
      /caller\.artist\.book\.availability\(\{\s*producerId/,
    );
    expect(pageSrc).toMatch(
      /caller\.artist\.store\.products\(\{\s*producerId/,
    );
    expect(pageSrc).toMatch(
      /caller\.artist\.book\.activePackages\(\{\s*producerId/,
    );
  });

  it("picks the active studio from ?studio= or the first studio", () => {
    expect(pageSrc).toMatch(/sp\.studio \?\? studios\[0\]\?\.producerId/);
  });

  it("passes a requested project only when it is an owned active package", () => {
    expect(pageSrc).toMatch(/sp\.project/);
    expect(pageSrc).toMatch(
      /activePackages\.some\(\(pkg\) => pkg\.projectId === sp\.project\)/,
    );
    expect(pageSrc).toMatch(/initialPackageProjectId=\{initialPackageProjectId\}/);
  });

  it("renders the BookingClient", () => {
    expect(pageSrc).toMatch(/<BookingClient/);
  });
});

describe("booking-client.tsx — confirm action wiring", () => {
  it("submits the canonical session duration", () => {
    expect(clientSrc).toMatch(/durationMin: DEFAULT_DURATION_MIN/);
  });

  it("sends productId only when not paying with a credit", () => {
    expect(clientSrc).toMatch(
      /productId: usingCredit \? null : selectedProductId/,
    );
  });

  it("threads the existing package project id for credit redemption", () => {
    expect(clientSrc).toMatch(/existingProjectId: selectedPackageProjectId/);
  });

  it("refreshes the route after a successful request", () => {
    expect(clientSrc).toMatch(/router\.refresh\(\)/);
    expect(clientSrc).toMatch(/if \(res\.ok\) router\.refresh\(\)/);
  });
});

describe("booking-client.tsx — request/pending language (not instant-book)", () => {
  it("keeps a request-flavoured primary label", () => {
    expect(clientSrc).toMatch(/Send booking request|Request this slot/i);
  });

  it("never claims an instant 'Book this slot'", () => {
    expect(clientSrc).not.toMatch(/Book this slot/);
  });
});

describe("booking-client.tsx — calendar greying math", () => {
  it("enables a day only when available and not in the past", () => {
    expect(clientSrc).toMatch(/const enabled = available && !inPast/);
  });

  it("computes past days against today (string compare)", () => {
    expect(clientSrc).toMatch(/inPast = cell\.iso < today/);
  });
});

describe("booking-client.tsx — accessibility + keyboard nav", () => {
  it("exposes the calendar as a grid with gridcells", () => {
    expect(clientSrc).toMatch(/role="grid"/);
    expect(clientSrc).toMatch(/role="gridcell"/);
  });

  it("keeps arrow-key roving + aria-selected on cells", () => {
    expect(clientSrc).toMatch(/onGridKeyDown/);
    expect(clientSrc).toMatch(/aria-selected/);
  });

  it("keeps the polite live region on the calendar footer", () => {
    expect(clientSrc).toMatch(/aria-live="polite"/);
  });
});

describe("booking-client.tsx — progressive gating", () => {
  it("reveals services only after a start time, when not on a credit", () => {
    expect(clientSrc).toMatch(
      /const showServices = chosenStart != null && !usingCredit/,
    );
  });

  it("reveals confirm once a start + (credit or product) is chosen", () => {
    expect(clientSrc).toMatch(
      /const showConfirm =\s*chosenStart != null && \(usingCredit \|\| selectedProductId !== null\)/,
    );
  });
});

describe("booking-client.tsx — prepaid credits path", () => {
  it("disables a depleted package", () => {
    expect(clientSrc).toMatch(
      /!pkg\.unlimitedSessions && pkg\.sessionsRemaining <= 0/,
    );
  });

  it("preselects the server-validated project from the payment flow", () => {
    expect(clientSrc).toMatch(/initialPackageProjectId: string \| null/);
    expect(clientSrc).toMatch(
      /setSelectedPackageProjectId\] = useState<[\s\S]*?>\(initialPackageProjectId\)/,
    );
  });

  it("clears a selected credit when a refresh removes the exhausted package", () => {
    expect(clientSrc).toMatch(
      /if \(selectedPackageProjectId && !selectedPackage\) \{\s*setSelectedPackageProjectId\(null\)/,
    );
  });

  it("shows unlimited credit as ongoing instead of zero remaining", () => {
    expect(clientSrc).toMatch(/unlimitedSessions: boolean/);
    expect(clientSrc).toMatch(/pkg\.unlimitedSessions\s*\?\s*"Ongoing"/);
    expect(clientSrc).toMatch(
      /selectedPackage\?\.unlimitedSessions\s*\?\s*"Use credit · Ongoing"/,
    );
  });

  it("offers the 'pay for a new session instead' toggle", () => {
    expect(clientSrc).toMatch(/Pay for a new session instead/);
  });
});

describe("booking-client.tsx — multi-studio switching", () => {
  it("shows the picker only when more than one studio is connected", () => {
    expect(clientSrc).toMatch(/studios\.length > 1/);
    expect(clientSrc).toMatch(/<ProducerPicker/);
  });

  it("switches studio via the ?studio= search param", () => {
    expect(clientSrc).toMatch(/handleSwitchStudio/);
    expect(clientSrc).toMatch(/\/artist\/book\?studio=/);
  });
});
