// Certificate of Completion PDF — rendered with @react-pdf/renderer and
// appended to the flattened contract by flatten.ts. Plain, formal
// styling; no logo / fancy typography. The goal is a legible, printable
// audit record listing who signed, when, from what IP-hash, and the
// chronological event log.
//
// Exported as buildAuditCert(...) returning a Node Buffer (which is a
// Uint8Array subclass — callers can pass it straight to pdf-lib's
// PDFDocument.load).
import type {
  Contract,
  ContractEvent,
  ContractRecipient,
} from "@skitza/db";
import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

// Styles — sans-serif, 10pt body, 14pt title. Light rules between
// rows to keep the tables readable without looking like a spreadsheet.
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 14, marginBottom: 16, fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  meta: { marginBottom: 4 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#999",
    paddingVertical: 3,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingVertical: 3,
    fontFamily: "Helvetica-Bold",
  },
  colName: { width: "22%" },
  colEmail: { width: "30%" },
  colSigned: { width: "28%" },
  colIp: { width: "20%" },
  eventRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
    paddingVertical: 2,
  },
  evTime: { width: "25%" },
  evKind: { width: "15%" },
  evWho: { width: "25%" },
  evMeta: { width: "35%" },
  footer: { marginTop: 24, fontSize: 8, color: "#666" },
});

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function summariseMeta(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  try {
    const s = JSON.stringify(meta);
    return truncate(s, 60);
  } catch {
    return "";
  }
}

type Props = {
  contract: Contract;
  recipients: ContractRecipient[];
  events: ContractEvent[];
};

export function AuditCertDocument({ contract, recipients, events }: Props) {
  // Chronological sort; occurredAt is a Date.
  const sorted = [...events].sort((a, b) => {
    const ta = a.occurredAt instanceof Date ? a.occurredAt.getTime() : 0;
    const tb = b.occurredAt instanceof Date ? b.occurredAt.getTime() : 0;
    return ta - tb;
  });
  const recipientById = new Map(recipients.map((r) => [r.id, r]));

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Certificate of Completion — Skitza</Text>

        <View style={styles.section}>
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Contract ID: </Text>
            {contract.id}
          </Text>
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Title: </Text>
            {contract.title}
          </Text>
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Status: </Text>
            {contract.status}
          </Text>
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Signed at: </Text>
            {fmtDate(contract.signedAt)}
          </Text>
          <Text style={styles.meta}>
            <Text style={styles.metaLabel}>Created at: </Text>
            {fmtDate(contract.createdAt)}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recipients</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.colName}>Name</Text>
            <Text style={styles.colEmail}>Email</Text>
            <Text style={styles.colSigned}>Signed at</Text>
            <Text style={styles.colIp}>IP hash</Text>
          </View>
          {recipients.map((r) => (
            <View key={r.id} style={styles.tableRow}>
              <Text style={styles.colName}>{r.name}</Text>
              <Text style={styles.colEmail}>{r.email}</Text>
              <Text style={styles.colSigned}>{fmtDate(r.signedAt)}</Text>
              <Text style={styles.colIp}>{truncate(r.ipHash, 12)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Event log</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.evTime}>Timestamp</Text>
            <Text style={styles.evKind}>Event</Text>
            <Text style={styles.evWho}>Recipient</Text>
            <Text style={styles.evMeta}>Metadata</Text>
          </View>
          {sorted.map((e) => {
            const who = e.recipientId ? recipientById.get(e.recipientId)?.name ?? "—" : "—";
            return (
              <View key={e.id} style={styles.eventRow}>
                <Text style={styles.evTime}>{fmtDate(e.occurredAt)}</Text>
                <Text style={styles.evKind}>{e.event}</Text>
                <Text style={styles.evWho}>{who}</Text>
                <Text style={styles.evMeta}>{summariseMeta(e.metadata)}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>
          Generated by Skitza. This certificate is embedded in the final PDF as an
          appended page and forms part of the signed document.
        </Text>
      </Page>
    </Document>
  );
}

export async function buildAuditCert(props: Props): Promise<Buffer> {
  return await renderToBuffer(<AuditCertDocument {...props} />);
}
