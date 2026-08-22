import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("@radix-ui/react-dialog", async () => {
  const { createElement, Fragment } = await import("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    Root: passthrough,
    Portal: passthrough,
    Overlay: () => null,
    Content: passthrough,
    Title: passthrough,
    Description: passthrough,
    Close: passthrough,
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("~/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("~/app/(producer)/dashboard/clients-projects/actions", () => ({
  claimSongSpaceAction: vi.fn(),
  createNoChargeSongProposalAction: vi.fn(),
}));

import {
  AddSongDialog,
  buildNoChargeProposalMessage,
  buildPaidExtraArtistMessage,
  noChargeProposalArtistPath,
  paidExtraArtistPath,
  type AddSongProjectOption,
} from "../add-song-dialog";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "add-song-dialog.tsx"), "utf8");
const musicPage = readFileSync(
  join(here, "..", "..", "..", "..", "app", "(producer)", "dashboard", "music", "page.tsx"),
  "utf8",
);
const compactSource = source.replace(/\s+/g, " ");
const sourceFile = ts.createSourceFile(
  "add-song-dialog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const projects: readonly AddSongProjectOption[] = [
  {
    id: "project-a",
    title: "Night Bus",
    clientName: "Maya Vale",
    emptySlots: [
      {
        id: "purchase-a:2",
        purchaseId: "purchase-a",
        slotNumber: 2,
        label: "Song space 2",
      },
    ],
    paidExtraProducts: [
      {
        id: "product-extra-one",
        name: "Extra production",
        priceCents: 120_000,
        currency: "ILS",
      },
      {
        id: "product-extra-two",
        name: "Mixing add-on",
        priceCents: 80_000,
        currency: "ILS",
      },
    ],
    noChargeAvailable: true,
  },
  {
    id: "project-b",
    title: "Quiet Shapes",
    clientName: null,
    emptySlots: [],
  },
];

function renderDialog(dialogProjects: readonly AddSongProjectOption[]): string {
  return renderToStaticMarkup(<AddSongDialog open onClose={vi.fn()} projects={dialogProjects} />);
}

function visit(node: ts.Node, callback: (candidate: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child) => {
    visit(child, callback);
  });
}

function callByName(name: string): ts.CallExpression | null {
  let match: ts.CallExpression | null = null;
  visit(sourceFile, (node) => {
    if (
      !match &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      match = node;
    }
  });
  return match;
}

function firstObjectArgument(call: ts.CallExpression): Map<string, ts.Expression> {
  const argument = call.arguments[0];
  expect(argument && ts.isObjectLiteralExpression(argument)).toBe(true);
  const properties = new Map<string, ts.Expression>();
  if (!argument || !ts.isObjectLiteralExpression(argument)) return properties;
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText(sourceFile).replace(/["']/g, "");
    properties.set(name, property.initializer);
  }
  return properties;
}

function importedNoChargeActionName(): string | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier.getText(sourceFile).includes("clients-projects/actions")) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (/no.?charge/i.test(imported)) return element.name.text;
    }
  }
  return null;
}

function rootIdentifier(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return rootIdentifier(expression.expression);
  return null;
}

function bindingContainsIdentifier(name: ts.BindingName, identifier: string): boolean {
  if (ts.isIdentifier(name)) return name.text === identifier;
  return name.elements.some(
    (element) =>
      ts.isBindingElement(element) && bindingContainsIdentifier(element.name, identifier),
  );
}

function hasStableHookDeclaration(identifier: string): boolean {
  let found = false;
  visit(sourceFile, (node) => {
    if (found || !ts.isVariableDeclaration(node)) return;
    if (!bindingContainsIdentifier(node.name, identifier) || !node.initializer) return;
    if (!ts.isCallExpression(node.initializer)) return;
    const hook = node.initializer.expression.getText(sourceFile);
    found = /^(?:React\.)?use(?:Ref|State|Memo)$/.test(hook);
  });
  return found;
}

function noChargeButtonDisabledExpression(): string | null {
  let expression: string | null = null;
  visit(sourceFile, (node) => {
    if (expression || !ts.isJsxElement(node)) return;
    if (!node.getText(sourceFile).includes("Create ₪0 proposal")) return;
    const disabled = node.openingElement.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "disabled",
    );
    const initializer = disabled?.initializer;
    if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
      expression = initializer.expression.getText(sourceFile);
    }
  });
  return expression;
}

describe("Add Song project choice", () => {
  it("renders an active-project chooser with every supplied active project", () => {
    const html = renderDialog(projects);
    expect(html).toContain("Active project");
    expect(html).toContain('value="project-a"');
    expect(html).toContain("Night Bus · Maya Vale");
    expect(html).toContain('value="project-b"');
    expect(html).toContain("Quiet Shapes");
  });

  it("sends an empty project list to truthful project-entry guidance", () => {
    const html = renderDialog([]);
    expect(html).toContain("You need an active project first");
    expect(html).toContain("Projects start through your Skitza link");
    expect(html).toContain('href="/dashboard/clients-projects"');
    expect(html).toContain("Open Clients &amp; Projects");
    expect(html).not.toContain("newProject=1");
    expect(musicPage).toContain('redirect("/dashboard/clients-projects")');
    expect(musicPage).not.toContain("newProject=1");
  });

  it("does not silently fall back to another project when a row target is unavailable", () => {
    expect(compactSource).toContain(
      'preferred?.id ?? (initialProjectId ? "" : (projects[0]?.id ?? ""))',
    );
    expect(source).toContain("This project is unavailable for new work.");
    expect(source).toContain("Choose another active project");
  });

  it("keeps an exact row project locked even after that project becomes unavailable", () => {
    expect(source).toContain("disabled={lockInitialProject}");
    expect(source).toContain("The selected project is no longer active.");
  });

  it("can lock Add Another Song to its selected single", () => {
    expect(source).toContain("lockInitialProject");
    expect(source).toContain("disabled={lockInitialProject}");
  });
});

describe("Add Song entitlement actions", () => {
  it("claims the exact selected unused purchase rather than a project balance", () => {
    expect(compactSource).toMatch(
      /emptySlots\.find\(\(candidate\) => candidate\.purchaseId === initialPurchaseId\)/,
    );
    const call = callByName("claimSongSpaceAction");
    expect(call).not.toBeNull();
    if (!call) return;
    const input = firstObjectArgument(call);
    expect(input.get("projectId")?.getText(sourceFile)).toBe("project.id");
    expect(input.get("purchaseId")?.getText(sourceFile)).toBe("slot.purchaseId");
    expect(input.get("title")?.getText(sourceFile)).toBe("normalizedTitle");
    expect(source).toContain("This purchased song space is no longer available.");
    expect(compactSource).not.toMatch(
      /find\(\(candidate\) => candidate\.purchaseId === initialPurchaseId\) \?\? project\.emptySlots\[0\]/,
    );
  });

  it("requires a title and reuses a stable operation key for a No charge retry", () => {
    const actionName = importedNoChargeActionName();
    expect(actionName, "Add Song must import a dedicated No charge action").not.toBeNull();
    const call = actionName ? callByName(actionName) : null;
    expect(call, "the dedicated No charge action must be called").not.toBeNull();
    if (!call) return;

    const input = firstObjectArgument(call);
    expect(input.get("projectId")?.getText(sourceFile)).toBe("project.id");
    expect(input.get("title")?.getText(sourceFile)).toMatch(/normalizedTitle|title\.trim\(\)/);

    const operationKey = input.get("operationKey");
    expect(operationKey, "No charge must send an idempotency operation key").toBeDefined();
    if (!operationKey) return;
    expect(ts.isCallExpression(operationKey)).toBe(false);
    expect(operationKey.getText(sourceFile)).not.toMatch(/randomUUID|Date\.now|Math\.random/);
    const keyIdentifier = rootIdentifier(operationKey);
    expect(keyIdentifier).not.toBeNull();
    expect(keyIdentifier && hasStableHookDeclaration(keyIdentifier)).toBe(true);

    const disabledExpression = noChargeButtonDisabledExpression();
    expect(disabledExpression).not.toBeNull();
    expect(disabledExpression).toMatch(/title\.trim\(\)|normalizedTitle/);
  });

  it("creates only a proposal and copies a signed-in artist review link", () => {
    expect(source).toContain("createNoChargeSongProposalAction");
    expect(source).toContain("no purchase or song space exists yet");
    expect(source).toContain("matching artist must review and accept");
    expect(source).not.toContain("No charge song added");
    expect(noChargeProposalArtistPath("proposal/with spaces")).toBe(
      "/artist/music/no-charge/proposal%2Fwith%20spaces",
    );
    const message = buildNoChargeProposalMessage({
      proposalToken: "proposal-one",
      projectTitle: "Night Bus",
      songTitle: "Second Light",
    });
    expect(message).toContain("https://skitza.app/artist/music/no-charge/proposal-one");
    expect(message).toContain("Second Light");
    expect(message).toContain("matching artist");
    expect(message).toContain("only after the artist accepts");
  });

  it("explains the paid-extra gate without pretending acceptance already happened", () => {
    expect(source).toContain("complete first installment");
    expect(source).toContain("artist acceptance");
    expect(source).toContain("Add to an existing project");
    expect(source).toContain("paidExtraProducts");
    expect(source).toContain("clipboard.writeText");
    expect(source).not.toContain("project.paidExtraHref");
  });

  it("copies the signed-in artist route with an explicit exact-project instruction", () => {
    expect(paidExtraArtistPath("product/with spaces")).toBe(
      "/artist/purchase/product%2Fwith%20spaces",
    );
    const message = buildPaidExtraArtistMessage({
      productId: "product-extra-one",
      productName: "Extra production",
      projectTitle: "Night Bus",
    });
    expect(message).toContain("https://skitza.app/artist/purchase/product-extra-one");
    expect(message).toContain("Extra production");
    expect(message).toContain("Add to an existing project");
    expect(message).toContain("exact project “Night Bus”");
    expect(message).toContain("complete first installment");
    expect(message).not.toContain("accepted for you");
    expect(message).not.toContain("?project");
  });

  it("requires an explicit product choice and handles no eligible product honestly", () => {
    expect(source).toContain("Choose a per-song product");
    expect(source).toContain("No enabled positive-price per-song Store product is available");
    expect(source).toContain("disabled={!selectedPaidExtraProduct}");
  });

  it("does not mount the upload modal or use placeholder navigation", () => {
    expect(source).not.toContain("UploadTrackModal");
    expect(source).not.toContain("action=upload");
    expect(source).not.toMatch(/href\s*=\s*["']#["']/);
    expect(source).not.toContain("javascript:");
  });
});
