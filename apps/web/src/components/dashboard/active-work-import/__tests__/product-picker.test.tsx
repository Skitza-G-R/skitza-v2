// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportRowEditor, type ImportEditorMemory } from "../import-row-editor";
import {
  applyTemplate,
  newImportDraft,
  type ActiveWorkImportDraft,
  type ImportAssessmentView,
  type StoreTemplateOption,
  type WorkspaceImportRow,
} from "../model";

const defaults = {
  defaultCurrency: "USD",
  defaultTaxMode: "tax_added" as const,
  defaultTaxRatePct: 17,
};

function albumProduct(overrides: Partial<StoreTemplateOption> = {}): StoreTemplateOption {
  return {
    id: "product-album",
    name: "Album production",
    kind: "album",
    service: "Production",
    deliverables: ["Mixes", "Masters"],
    subtotalCents: 250_000,
    currency: "USD",
    taxMode: "tax_added",
    taxRatePct: 17,
    includedSongSpaces: 8,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: {
      master: { mode: "percentage", bps: 1_500 },
      composition: { mode: "percentage", bps: 500, role: "composer" },
    },
    rights: ["Artist owns the masters"],
    plans: [{ kind: "split_50_50" }],
    agreementText: "Existing agreement text",
    agreementPdf: null,
    session: {
      limit: { kind: "fixed", count: 4 },
      durationMin: 90,
      locationType: "studio",
      bufferMinutes: 15,
      minLeadHours: 24,
    },
    ...overrides,
  };
}

function mixProduct(): StoreTemplateOption {
  return albumProduct({
    id: "product-mix",
    name: "Single mix",
    kind: "mix",
    service: "Mixing",
    deliverables: ["One mixed single"],
    subtotalCents: 40_000,
    includedSongSpaces: 1,
    revisionRule: { kind: "unlimited" },
    royaltyTerms: null,
    rights: [],
    plans: [{ kind: "full" }],
    agreementText: "",
    session: null,
  });
}

function Harness({
  templates,
  initialDraft = newImportDraft(defaults),
  assessment = null,
  stepIndex = 1,
  revealed = false,
}: {
  templates: readonly StoreTemplateOption[];
  initialDraft?: ActiveWorkImportDraft;
  assessment?: ImportAssessmentView | null;
  stepIndex?: number;
  revealed?: boolean;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const memory = useRef(
    new Map<string, ImportEditorMemory>([
      [
        "row-op",
        {
          activeStepIndex: stepIndex,
          completedThrough: stepIndex - 1,
          revealedSteps: revealed ? [stepIndex] : [],
        },
      ],
    ]),
  );
  const row: WorkspaceImportRow = {
    rowId: "row-1",
    operationKey: "row-op",
    revision: 1,
    draft,
    assessment,
    materializedAtIso: null,
    createdClientContactId: null,
    createdProjectId: null,
    createdPurchaseId: null,
    saveState: "idle",
    saveError: null,
    materializeError: null,
    localVersion: 1,
    persistedLocalVersion: 1,
  };
  return (
    <>
      <ImportRowEditor
        row={row}
        index={0}
        clients={[]}
        archivedClients={[]}
        templates={templates}
        mobile={false}
        onBack={vi.fn()}
        onChange={setDraft}
        onContinueStep={() => Promise.resolve([])}
        onFinishItem={() => Promise.resolve([])}
        onSaveForLater={() => Promise.resolve(true)}
        onRemove={vi.fn()}
        removeDisabled={false}
        restoringClientId={null}
        onRestoreClient={vi.fn()}
        proofUploads={{}}
        onUploadProof={vi.fn()}
        onUploadAgreementPdf={vi.fn()}
        editorMemory={memory.current}
      />
      <output data-testid="row-draft">{JSON.stringify(draft)}</output>
    </>
  );
}

function currentDraft(): ActiveWorkImportDraft {
  return JSON.parse(screen.getByTestId("row-draft").textContent) as ActiveWorkImportDraft;
}

function productGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Product" });
}

afterEach(() => {
  cleanup();
});

describe("Project step product tiles", () => {
  it("shows one tile per Store product plus Custom deal, each with a kind icon and a mono price", () => {
    render(<Harness templates={[albumProduct(), mixProduct()]} />);

    const tiles = within(productGroup()).getAllByRole("button");
    expect(tiles.map((tile) => tile.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "Album production $2,500",
      "Single mix $400",
      "Custom deal",
    ]);
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(tiles.map((tile) => tile.getAttribute("data-product-tile"))).toEqual([
      "production",
      "mix",
      "custom",
    ]);
    const price = within(tiles[0] as HTMLElement).getByText("$2,500");
    expect(price.className).toContain("font-mono");
    expect(tiles[0]?.querySelector("svg")).not.toBeNull();
    expect(tiles[0]?.getAttribute("style") ?? "").not.toContain("gradient");
    expect(tiles[0]?.className).toContain("min-h-11");
    expect(tiles[0]?.className).toContain("rounded-[var(--radius-lg)]");
    expect(tiles[0]?.className).not.toContain("rounded-full");
  });

  it("fills the draft from a tapped product and shows the read-only summary instead of the form", async () => {
    const user = userEvent.setup();
    render(<Harness templates={[albumProduct(), mixProduct()]} />);

    expect(screen.getByLabelText("Agreement name")).not.toBeNull();
    await user.click(within(productGroup()).getByRole("button", { name: /Album production/ }));

    expect(currentDraft().agreement).toMatchObject({
      templateProductId: "product-album",
      name: "Album production",
      service: "Production",
      subtotal: "2500.00",
      planKind: "split_50_50",
    });
    const tile = within(productGroup()).getByRole("button", { name: /Album production/ });
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.className).toContain("border-[rgb(var(--brand-primary))]");
    expect(
      within(productGroup()).getByRole("button", { name: "Custom deal" }).getAttribute("aria-pressed"),
    ).toBe("false");

    const summary = screen.getByRole("region", { name: "From Album production" });
    expect(screen.queryByLabelText("Agreement name")).toBeNull();
    const line = (label: string) => within(summary).getByText(label).parentElement?.textContent;
    expect(line("Total")).toContain("$2,925");
    expect(line("Total")).toContain("Tax added · 17%");
    expect(line("Currency")).toContain("USD");
    expect(line("Song spaces")).toContain("8");
    expect(line("Sessions")).toContain("4 sessions · 90 min");
    expect(line("Deliverables")).toContain("2 items");
    expect(line("Rights")).toContain("Artist owns the masters");
    expect(line("Revisions")).toContain("2 revisions");
    expect(line("Royalties")).toContain("Master 15% · Composition 5%");
    expect(line("Payment plan")).toContain("50/50");
    expect(line("Terms")).toContain("Written terms · 23 characters");
    expect(within(summary).getByRole("button", { name: "Edit details" })).not.toBeNull();
    expect(within(summary).queryByRole("button", { name: "Reset to product" })).toBeNull();
  });

  it("reveals the full form from Edit details and offers Reset to product once the draft differs", async () => {
    const user = userEvent.setup();
    render(<Harness templates={[albumProduct()]} />);
    await user.click(within(productGroup()).getByRole("button", { name: /Album production/ }));

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    const price = screen.getByLabelText("Agreed price");
    expect(price).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reset to product" })).toBeNull();
    // The old Agreement step header and its template dropdown are gone.
    expect(screen.queryByText("Step 2 of 3", { exact: false })?.textContent).toBe("Step 2 of 3");
    expect(screen.queryByLabelText(/Store template/)).toBeNull();

    fireEvent.change(price, { target: { value: "2400.00" } });
    expect(currentDraft().agreement.subtotal).toBe("2400.00");
    const reset = await screen.findByRole("button", { name: "Reset to product" });
    await user.click(reset);

    expect(currentDraft().agreement.subtotal).toBe("2500.00");
    expect(currentDraft().agreement.templateProductId).toBe("product-album");
    expect(screen.queryByRole("button", { name: "Reset to product" })).toBeNull();
  });

  it("opens the form on its own when a Needs info reason lands on an agreement field", () => {
    const draft = applyTemplate(newImportDraft(defaults), albumProduct());
    render(
      <Harness
        templates={[albumProduct()]}
        initialDraft={draft}
        revealed
        assessment={{
          state: "needs_info",
          reasons: [
            {
              code: "agreement_price_required",
              field: "agreement.subtotalCents",
              message: "Add the agreed price.",
            },
          ],
        }}
      />,
    );

    const price = screen.getByLabelText("Agreed price");
    expect(price.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Add the agreed price.")).not.toBeNull();
    expect(screen.getByRole("region", { name: "From Album production" })).not.toBeNull();
  });

  it("names the product's PDF, asks for the same file, and keeps the drop zone in the summary", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        templates={[
          albumProduct({
            agreementText: "",
            agreementPdf: { fileName: "album-deal.pdf", sizeBytes: 2_048 },
          }),
        ]}
      />,
    );
    await user.click(within(productGroup()).getByRole("button", { name: /Album production/ }));

    const summary = screen.getByRole("region", { name: "From Album production" });
    const terms = within(summary).getByText("Terms").parentElement?.textContent ?? "";
    expect(terms).toContain("album-deal.pdf");
    expect(terms).toContain("Attach the same PDF");
    expect(within(summary).getByText("Drop the agreement PDF here")).not.toBeNull();
    expect(screen.queryByLabelText("Agreement name")).toBeNull();
  });

  it("keeps the typed details but detaches the product on Custom deal", async () => {
    const user = userEvent.setup();
    render(<Harness templates={[albumProduct()]} />);
    await user.click(within(productGroup()).getByRole("button", { name: /Album production/ }));
    await user.click(within(productGroup()).getByRole("button", { name: "Custom deal" }));

    expect(currentDraft().agreement.templateProductId).toBeNull();
    expect(currentDraft().agreement.name).toBe("Album production");
    expect(screen.getByLabelText("Agreement name")).not.toBeNull();
    expect(screen.queryByRole("region", { name: /^From / })).toBeNull();
  });

  it("shows the plain form with no tiles when the Store has no products", () => {
    render(<Harness templates={[]} />);

    expect(screen.queryByRole("group", { name: "Product" })).toBeNull();
    expect(screen.getByLabelText("Agreement name")).not.toBeNull();
    expect(screen.getByLabelText("Service")).not.toBeNull();
  });
});

describe("Client and Project steps", () => {
  it("keeps the Client step to name, email and phone and continues to the project", () => {
    render(<Harness templates={[albumProduct()]} stepIndex={0} />);

    expect(screen.getByRole("heading", { name: "Client" })).not.toBeNull();
    expect(screen.getByLabelText("Client name")).not.toBeNull();
    expect(screen.getByLabelText("Email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add phone" })).not.toBeNull();
    expect(screen.queryByLabelText("Project name")).toBeNull();
    expect(screen.queryByRole("group", { name: "Product" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to project" })).not.toBeNull();
  });

  it("collapses the deadline behind Add deadline and continues to payments", async () => {
    const user = userEvent.setup();
    render(<Harness templates={[albumProduct()]} />);

    expect(screen.getByRole("heading", { name: "Project" })).not.toBeNull();
    expect(screen.getByLabelText("Project name")).not.toBeNull();
    expect(screen.queryByLabelText(/Deadline/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add deadline" }));
    fireEvent.change(screen.getByLabelText(/Deadline/), { target: { value: "2026-10-05" } });
    expect(currentDraft().project.deadlineAt).toBe("2026-10-05");
    expect(screen.getByRole("button", { name: "Continue to payments" })).not.toBeNull();
  });

  it("labels the step nav Client, Project and Payments", () => {
    render(<Harness templates={[]} />);

    const steps = within(screen.getByRole("navigation", { name: "Item steps" })).getAllByRole(
      "button",
    );
    expect(steps.map((step) => step.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "01Client",
      "02Project",
      "03Payments",
    ]);
  });
});
