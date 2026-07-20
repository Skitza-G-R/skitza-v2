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
  it("resolves availability and exact active allowances without a fail-only product path", () => {
    expect(pageSrc).toMatch(/caller\.artist\.studios\(\)/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.availability\(\{\s*producerId/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.activePackages\(\{\s*producerId/);
    expect(pageSrc).not.toMatch(/caller\.artist\.store\.products/);
  });

  it("supports current and legacy studio links plus owned reschedule context", () => {
    expect(pageSrc).toMatch(/sp\.studio/);
    expect(pageSrc).toMatch(/sp\.producerId/);
    expect(pageSrc).toMatch(
      /const activeStudioId =\s*rescheduleSession\?\.producerId \?\? sp\.studio \?\? sp\.producerId/,
    );
    expect(pageSrc).toMatch(/caller\.artist\.book\.session\(\{ id: sp\.session \}\)/);
  });

  it("accepts a project-only deep link only when it resolves to one allowance", () => {
    expect(pageSrc).toMatch(/sp\.project/);
    expect(pageSrc).toMatch(/uniquePrepaidSessionForProject/);
    expect(pageSrc).toMatch(/initialSessionAllowanceId=\{initialSessionAllowanceId\}/);
  });

  it("prefers an exact allowance deep link and carries booking context to availability", () => {
    expect(pageSrc).toMatch(/sp\.allowance/);
    expect(pageSrc).toMatch(/findPrepaidSessionByAllowance/);
    expect(pageSrc).toMatch(/bookingId: rescheduleSession\?\.id/);
  });

  it("locks reschedule to the original purchase-owned allowance", () => {
    expect(pageSrc).toMatch(/const selectablePackages = rescheduleSession/);
    expect(pageSrc).toMatch(
      /row\.sessionAllowanceId === rescheduleSession\.sessionAllowanceId/,
    );
    expect(pageSrc).toMatch(/activePackages=\{selectablePackages\}/);
    expect(pageSrc).toMatch(
      /rescheduleSession\?\.sessionAllowanceId \?\? sp\.allowance/,
    );
  });

  it("renders the BookingClient", () => {
    expect(pageSrc).toMatch(/<BookingClient/);
  });
});

describe("booking-client.tsx — confirm action wiring", () => {
  it("submits the exact purchased allowance duration", () => {
    expect(clientSrc).toMatch(/durationMin: selectedPackage\.durationMin/);
  });

  it("does not expose a direct product-booking path", () => {
    expect(clientSrc).toMatch(/productId: null/);
    expect(clientSrc).not.toMatch(/selectedProductId|ServiceBlock/);
    expect(clientSrc).toMatch(/href="\/artist\/store"/);
  });

  it("threads the exact project, purchase, and allowance identity", () => {
    expect(clientSrc).toMatch(/existingProjectId: selectedPackage\.projectId/);
    expect(clientSrc).toMatch(/purchaseId: selectedPackage\.purchaseId/);
    expect(clientSrc).toMatch(/sessionAllowanceId: selectedPackage\.sessionAllowanceId/);
    expect(clientSrc).toMatch(/operationKey/);
  });

  it("lands on the exact real session after success", () => {
    expect(clientSrc).toMatch(/router\.push\(`\/artist\/sessions\?just=\$\{res\.id\}`\)/);
  });

  it("uses the atomic reschedule action for an existing booking", () => {
    expect(clientSrc).toMatch(/rescheduleBookingAction/);
    expect(clientSrc).toMatch(/id: rescheduleSessionId/);
    expect(clientSrc).not.toMatch(/confirmBookingAction\(\{[\s\S]*id: rescheduleSessionId/);
  });
});

describe("booking-client.tsx — automatic confirmation copy", () => {
  it("derives Request vs Book from the purchase producer setting", () => {
    expect(clientSrc).toMatch(/bookingActionLabel\(!selectedPackage\?\.autoConfirm\)/);
    expect(clientSrc).toMatch(/Request this slot|bookingActionLabel/);
    expect(clientSrc).toMatch(/Book this slot|bookingActionLabel/);
  });

  it("explains instant confirmation and manual approval separately", () => {
    expect(clientSrc).toMatch(/confirmed immediately/);
    expect(clientSrc).toMatch(/while \$\{activeStudio\.name\} confirms/);
  });
});

describe("booking-client.tsx — calendar greying math", () => {
  it("offers every valid producer half-hour start", () => {
    expect(clientSrc).toMatch(/const SLOT_INCREMENT_MIN = 30/);
    expect(clientSrc).toMatch(/t \+= SLOT_INCREMENT_MIN/);
  });

  it("uses the server-authored studio date and timezone", () => {
    expect(clientSrc).toMatch(/const today = availability\.today/);
    expect(clientSrc).toMatch(/timeZone=\{availability\.timeZone\}/);
    expect(clientSrc).toMatch(/Studio time/);
    expect(clientSrc).not.toMatch(/resolvedOptions\(\)\.timeZone/);
  });

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
    expect(clientSrc).toMatch(/data-date=\{dateISO\}/);
    expect(clientSrc).toMatch(/setFocusedDate\(target\)/);
    expect(clientSrc).toMatch(/aria-disabled=\{disabled\}/);
    expect(clientSrc).not.toMatch(/(?:^|\s)disabled=\{disabled\}/);
    expect(clientSrc).toMatch(/y < year \|\| \(y === year && m - 1 < month0\)/);
    expect(clientSrc).toMatch(/y > year \|\| \(y === year && m - 1 > month0\)/);
  });

  it("keeps the polite live region on the calendar footer", () => {
    expect(clientSrc).toMatch(/aria-live="polite"/);
  });
});

describe("booking-client.tsx — progressive gating", () => {
  it("reveals confirm only for an exact purchased allowance", () => {
    expect(clientSrc).toMatch(/chosenStart != null[\s\S]*selectedPackage !== null/);
  });

  it("shows the allowance picker before the calendar and clears an invalid time when it changes", () => {
    expect(clientSrc.indexOf("<CreditsBlock")).toBeLessThan(clientSrc.indexOf("<CalendarCard"));
    expect(clientSrc).toMatch(/resetSelection\(\);\s*setSelectedSessionAllowanceId\(id\)/);
  });
});

describe("booking-client.tsx — prepaid credits path", () => {
  it("disables a depleted package", () => {
    expect(clientSrc).toMatch(/!pkg\.unlimitedSessions && pkg\.sessionsRemaining <= 0/);
  });

  it("preselects the server-validated allowance identity", () => {
    expect(clientSrc).toMatch(/initialSessionAllowanceId: string \| null/);
    expect(clientSrc).toMatch(
      /setSelectedSessionAllowanceId\] = useState<[\s\S]*?>\(\s*initialSessionAllowanceId\s*,?\s*\)/,
    );
  });

  it("clears a selected credit when a refresh removes the exhausted package", () => {
    expect(clientSrc).toMatch(
      /if \(selectedSessionAllowanceId && !selectedPackage\) \{\s*setSelectedSessionAllowanceId\(null\)/,
    );
  });

  it("shows unlimited credit as ongoing instead of zero remaining", () => {
    expect(clientSrc).toMatch(/unlimitedSessions: boolean/);
    expect(clientSrc).toMatch(/pkg\.unlimitedSessions\s*\?\s*"Ongoing"/);
    expect(clientSrc).toMatch(/pkg\.unlimitedSessions\s*\?\s*"Ongoing"/);
  });

  it("shows the purchased duration, location, lead time, and buffer", () => {
    expect(clientSrc).toMatch(/selectedPackage\.durationMin/);
    expect(clientSrc).toMatch(/selectedPackage\.locationType/);
    expect(clientSrc).toMatch(/selectedPackage\.minLeadHours/);
    expect(clientSrc).toMatch(/selectedPackage\.bufferMinutes/);
  });

  it("keeps phone controls at least 44px and the sticky CTA above shell chrome", () => {
    expect(clientSrc).toMatch(/className="grid grid-cols-7 gap-0 sm:gap-1"/);
    expect(clientSrc).toMatch(/relative flex h-11 items-center/);
    expect(clientSrc).toMatch(/bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("redirects new commercial intent to the Store request flow", () => {
    expect(clientSrc).toMatch(/Request a new service instead/);
    expect(clientSrc).toMatch(/Browse services to request a session/);
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
