import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "page.tsx"), "utf8");
const compactSource = source.replace(/\s+/g, " ");

describe("SK-146 Client Space server shell", () => {
  it("keeps authentication ahead of every producer-scoped read", () => {
    expect(compactSource).toContain(
      'const { userId } = await auth(); if (!userId) redirect("/sign-in");',
    );
    expect(source.indexOf("await auth()")).toBeLessThan(
      source.indexOf("appRouter.createCaller({ userId })"),
    );
  });

  it("preserves SK-145's exact three concurrent Client Space reads", () => {
    expect(compactSource).toContain(
      "const [detailResult, paymentsResult, producerProfileResult] = await Promise.allSettled([ caller.clientContacts.clientSpaceDetail({ id }), caller.purchaseLedger.client({ clientContactId: id }), caller.producer.me(), ]);",
    );
    expect(source.match(/Promise\.allSettled/g)).toHaveLength(1);
    expect(source).not.toContain("clientContacts.detail({ id })");
  });

  it("turns a rejected detail or canonical ledger read into notFound", () => {
    expect(compactSource).toContain(
      'if (detailResult.status === "rejected" || paymentsResult.status === "rejected") { notFound(); }',
    );
  });

  it("degrades a rejected producer profile without hiding the client", () => {
    expect(compactSource).toContain(
      'const producerProfile = producerProfileResult.status === "fulfilled" ? producerProfileResult.value : null;',
    );
    expect(compactSource).toContain(
      'if (producerProfileResult.status === "rejected") { console.warn("[clients/detail] producer.me failed", producerProfileResult.reason); }',
    );

    const producerFallback = source.slice(
      source.indexOf("const producerProfile ="),
      source.indexOf("const paymentBuckets ="),
    );
    expect(producerFallback).not.toContain("notFound");
  });

  it("maps the canonical ledger into the client workspace", () => {
    expect(source).toContain('from "~/components/dashboard/clients/client-space-workspace"');
    expect(source).toContain("toProducerPaymentWorkspaceBuckets(payments.producerBuckets)");
    expect(compactSource).toContain(
      "const paymentTotals: ClientSpacePaymentTotal[] = payments.totals.map((total) => ({ currency: total.currency, dueNowCents: total.dueNowCents, totalRemainingCents: total.totalRemainingCents, }));",
    );
    expect(compactSource).toContain(
      'purchase.proofs.filter((proof) => proof.status === "pending").length',
    );
    expect(compactSource).toMatch(
      /<ClientSpaceWorkspace key=\{detail\.contact\.id\} client=\{client\} projects=\{projects\} paymentBuckets=\{paymentBuckets\} paymentTotals=\{paymentTotals\} needsReviewCount=\{needsReviewCount\}/,
    );
    expect(source).not.toMatch(/<ProducerPaymentWorkspace/);
    expect(source).not.toMatch(/<ClientMoneyLedger/);
  });

  it("keeps private offers lazy behind the client workspace", () => {
    expect(source).not.toContain("loadClientPrivateOffersAction");
    expect(source).not.toContain("PrivateOfferManager");
    expect(source).not.toMatch(/caller\.[\w.]*privateOffers?/);
    expect(source).not.toMatch(/privateOffers?\.(list|history|client)/);
  });

  it("maps all project lifecycle states without reviving the legacy detail shell", () => {
    expect(source).toContain("detail.projects.map");
    for (const label of ["Waiting for payment", "Active", "Paused", "Completed", "Canceled"]) {
      expect(source).toContain(label);
    }
    for (const legacy of [
      "ClientSpaceHero",
      "ProjectRow",
      "ClientDetailHeader",
      "ClientDetailTabs",
      "ClientOverviewPanel",
      "ClientPaymentsPanel",
      "ClientProjectsPanel",
      "ClientNotesPanel",
      "resolveClientDetailTab",
    ]) {
      expect(source).not.toContain(legacy);
    }
  });

  it("releases the route entry transform after animation without changing the shared primitive", () => {
    expect(compactSource).toContain(
      '<main className="sk-page-enter" style={{ animationFillMode: "backwards" }}>',
    );

    const routeRootStart = source.indexOf('<main className="sk-page-enter"');
    const routeRootEnd = source.indexOf(">", routeRootStart);
    expect(routeRootStart).toBeGreaterThanOrEqual(0);
    expect(routeRootEnd).toBeGreaterThan(routeRootStart);

    const routeRoot = source.slice(routeRootStart, routeRootEnd + 1);
    expect(routeRoot).toContain('animationFillMode: "backwards"');
    expect(routeRoot).not.toMatch(/animationFillMode:\s*"(?:both|forwards)"/);
  });
});
