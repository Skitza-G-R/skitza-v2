import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import * as schema from "../schema";

function foreignKeyNames(table: PgTable): string[] {
  return getTableConfig(table).foreignKeys.map((key) => key.getName());
}

function migrationSql(): string {
  const path = join(process.cwd(), "drizzle", "0027_purchase_foundation.sql");
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
}

function splitTopLevelStatements(source: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let dollarTag: string | null = null;

  for (let index = 0; index < source.length; ) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        buffer += source[index];
        index += 1;
      }
      continue;
    }

    const openingTag = source.slice(index).match(/^\$([A-Za-z0-9_]*)\$/)?.[0];
    if (openingTag) {
      dollarTag = openingTag;
      buffer += openingTag;
      index += openingTag.length;
      continue;
    }

    if (source[index] === ";") {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      index += 1;
      continue;
    }

    buffer += source[index];
    index += 1;
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

function createdConstraintInventory(source: string): string[] {
  const inventory = new Set<string>();
  let tableName: string | null = null;

  for (const line of source.split("\n")) {
    const createTable = line.match(/CREATE TABLE "public"\."([^"]+)"/);
    const alterTable = line.match(/ALTER TABLE "public"\."([^"]+)"/);
    if (createTable?.[1]) tableName = createTable[1];
    else if (alterTable?.[1]) tableName = alterTable[1];

    if (!tableName) continue;
    const namedConstraint = line.match(/CONSTRAINT "([^"]+)"/);
    if (namedConstraint?.[1]) inventory.add(`${tableName}|${namedConstraint[1]}`);
    if (/"id" uuid PRIMARY KEY/.test(line)) inventory.add(`${tableName}|${tableName}_pkey`);
  }

  return [...inventory].sort();
}

function completedGateInventory(
  source: string,
  alias: "expected_constraint" | "expected_index",
): string[] {
  const endToken = `) AS ${alias}`;
  const end = source.indexOf(endToken);
  expect(end, endToken).toBeGreaterThanOrEqual(0);
  const start = source.lastIndexOf("FROM (VALUES", end);
  expect(start, `${alias} VALUES`).toBeGreaterThanOrEqual(0);

  const inventory = new Set<string>();
  const values = source.slice(start, end);
  for (const match of values.matchAll(/\('([^']+)', '([^']+)'(?:,|\))/g)) {
    const tableName = match[1];
    const objectName = match[2];
    if (tableName && objectName) inventory.add(`${tableName}|${objectName}`);
  }
  return [...inventory].sort();
}

function completedColumnContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_columns");
  const start = source.lastIndexOf("FROM (VALUES", end);
  expect(start).toBeGreaterThanOrEqual(0);

  return [...source.slice(start, end).matchAll(/\('([^']+)', '([^']*)'\)/g)]
    .map((match) => `${match[1]}|${match[2]}`)
    .sort();
}

function createdColumnContracts(source: string): string[] {
  const contracts: string[] = [];

  for (const table of source.matchAll(/CREATE TABLE "public"\."([^"]+)" \(([\s\S]*?)\n  \);/g)) {
    const tableName = table[1];
    if (!tableName) continue;
    const columns: Array<{ name: string; spec: string }> = [];
    let current: { name: string; spec: string } | null = null;

    for (const line of (table[2] ?? "").split("\n")) {
      const start = line.match(/^    "([^"]+)"\s+(.+)/);
      if (start?.[1] && start[2]) {
        if (current) columns.push(current);
        current = { name: start[1], spec: start[2].trim() };
        continue;
      }
      if (!current) continue;
      const continuation = line.trim();
      if (continuation.startsWith("CONSTRAINT ")) {
        columns.push(current);
        current = null;
        break;
      }
      current.spec += ` ${continuation}`;
    }
    if (current) columns.push(current);

    const columnContract = columns
      .map(({ name, spec: rawSpec }) => {
        const spec = rawSpec.replace(/,$/, "");
        const enumType = spec.match(/^"public"\."([^"]+)"/);
        let type: string;
        if (enumType?.[1]) type = `public.${enumType[1]}`;
        else if (spec.startsWith("timestamp with time zone")) type = "pg_catalog.timestamptz";
        else {
          const sqlType = spec.match(/^(uuid|text|integer|bigint|boolean|jsonb)/)?.[1];
          const pgType = {
            uuid: "uuid",
            text: "text",
            integer: "int4",
            bigint: "int8",
            boolean: "bool",
            jsonb: "jsonb",
          }[sqlType ?? ""];
          expect(pgType, `${tableName}.${name} type`).toBeDefined();
          type = `pg_catalog.${pgType}`;
        }

        const nullable = spec.includes("NOT NULL") || spec.includes("PRIMARY KEY") ? "NO" : "YES";
        const defaultMatch = spec.match(/\bDEFAULT\s+(.+?)(?:\s+NOT NULL)?$/);
        let defaultValue = defaultMatch?.[1]?.trim() ?? "<none>";
        if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
          defaultValue = defaultValue.slice(1, -1);
        }
        return `${name}:${type}:${nullable}:${defaultValue}`;
      })
      .join(",");
    contracts.push(`${tableName}|${columnContract}`);
  }

  return contracts.sort();
}

function completedIndexDefinitions(source: string): string[] {
  const end = source.indexOf(") AS expected_index");
  const start = source.lastIndexOf("FROM (VALUES", end);
  expect(start).toBeGreaterThanOrEqual(0);

  return [
    ...source.slice(start, end).matchAll(/\('([^']+)', '([^']+)', \$index\$([\s\S]*?)\$index\$\)/g),
  ]
    .map((match) => `${match[1]}|${match[2]}|${match[3]}`)
    .sort();
}

function createdIndexDefinitions(source: string): string[] {
  return [
    ...source.matchAll(
      /CREATE (UNIQUE )?INDEX "([^"]+)"\s+ON "public"\."([^"]+)" \(([^)]+)\)(?:\s+WHERE ([^;]+))?;/g,
    ),
  ]
    .map((match) => {
      const unique = match[1] ? " UNIQUE" : "";
      const indexName = match[2];
      const tableName = match[3];
      const columns = sqlIdentifierList(match[4] ?? "")
        .map((column) => (column === "position" ? `"${column}"` : column))
        .join(", ");
      let predicate = (match[5] ?? "").replaceAll('"', "");
      if (predicate === "status = 'pending'") {
        predicate = "status = 'pending'::payment_proof_status";
      }
      const definition = `CREATE${unique} INDEX ${indexName} ON public.${tableName} USING btree (${columns})${predicate ? ` WHERE (${predicate})` : ""}`;
      return `${tableName}|${indexName}|${definition}`;
    })
    .sort();
}

function completedTriggerContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_trigger");
  const start = source.lastIndexOf("FROM (VALUES", end);
  expect(start).toBeGreaterThanOrEqual(0);
  return [...source.slice(start, end).matchAll(/\('([^']+)', '([^']+)', '([^']+)', (\d+)\)/g)]
    .map((match) => `${match[1]}|${match[2]}|${match[3]}|${match[4]}`)
    .sort();
}

function createdTriggerContracts(source: string): string[] {
  return [
    ...source.matchAll(
      /CREATE (?:CONSTRAINT )?TRIGGER "([^"]+)"\s+(BEFORE|AFTER) (INSERT OR UPDATE OR DELETE|INSERT OR UPDATE|UPDATE OR DELETE|UPDATE|INSERT) ON "public"\."([^"]+)"\s+(?:DEFERRABLE INITIALLY DEFERRED\s+)?FOR EACH ROW EXECUTE FUNCTION "public"\."([^"]+)"\(\);/g,
    ),
  ]
    .map((match) => {
      const timing = match[2] ?? "";
      const events = match[3] ?? "";
      let triggerType = 1 + (timing === "BEFORE" ? 2 : 0);
      if (events.includes("INSERT")) triggerType += 4;
      if (events.includes("DELETE")) triggerType += 8;
      if (events.includes("UPDATE")) triggerType += 16;
      return `${match[4]}|${match[1]}|${match[5]}|${triggerType}`;
    })
    .sort();
}

function completedFunctionContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_function");
  const start = source.lastIndexOf("FROM (VALUES", end);
  expect(start).toBeGreaterThanOrEqual(0);
  return [...source.slice(start, end).matchAll(/\('([^']+)', '([0-9a-f]{32})'\)/g)]
    .map((match) => `${match[1]}|${match[2]}`)
    .sort();
}

function createdFunctionContracts(source: string): string[] {
  return [
    ...source.matchAll(
      /CREATE FUNCTION "public"\."([^"]+)"\(\)\s+RETURNS trigger AS \$function\$([\s\S]*?)\$function\$ LANGUAGE plpgsql;/g,
    ),
  ]
    .map(
      (match) =>
        `${match[1]}|${createHash("md5")
          .update(match[2] ?? "")
          .digest("hex")}`,
    )
    .sort();
}

function createdIndexInventory(source: string): string[] {
  return [...source.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"\s+ON "public"\."([^"]+)"/g)]
    .map((match) => `${match[2]}|${match[1]}`)
    .sort();
}

const COMPLETED_TARGET_TABLES = new Set([
  "bookings",
  "notifications",
  "payment_proofs",
  "private_offers",
  "project_tracks",
  "projects",
  "purchase_acceptances",
  "purchase_cancellations",
  "purchase_download_override_events",
  "purchase_installments",
  "purchase_payment_corrections",
  "purchase_payments",
  "purchase_requests",
  "purchase_session_allowances",
  "purchase_waivers",
  "purchases",
  "song_public_links",
  "track_comments",
  "track_versions",
  "version_approval_events",
]);

function inventoryDigest(values: string[]): string {
  return createHash("md5")
    .update([...values].sort().join("\n"))
    .digest("hex");
}

function createdKeyConstraintContracts(source: string): string[] {
  const contracts: string[] = [];
  const ddl = source.slice(source.indexOf('ALTER TABLE "public"."producers"'));

  const serialize = (input: {
    deleteAction?: "c" | "r";
    foreignColumns?: string[];
    foreignTable?: string;
    localColumns: string[];
    name: string;
    table: string;
    type: "f" | "p" | "u";
  }): string => {
    const indexed = input.type !== "f";
    return [
      input.table,
      input.name,
      input.type,
      input.localColumns.join(","),
      input.foreignTable ?? "",
      input.foreignColumns?.join(",") ?? "",
      input.type === "f" ? "a" : "",
      input.type === "f" ? (input.deleteAction ?? "r") : "",
      input.type === "f" ? "s" : "",
      "false",
      "false",
      "true",
      "false",
      indexed ? "true" : "",
      indexed ? "true" : "",
      indexed ? "true" : "",
      indexed ? "true" : "",
      indexed ? String(input.type === "p") : "",
      indexed ? "false" : "",
    ].join("|");
  };

  for (const table of ddl.matchAll(/ALTER TABLE "public"\."([^"]+)"([\s\S]*?);/g)) {
    if (!table[1]) continue;
    for (const unique of (table[2] ?? "").matchAll(
      /ADD CONSTRAINT "([^"]+)" UNIQUE \(([^)]+)\)/g,
    )) {
      if (!unique[1]) continue;
      contracts.push(
        serialize({
          table: table[1],
          name: unique[1],
          type: "u",
          localColumns: sqlIdentifierList(unique[2] ?? ""),
        }),
      );
    }
  }

  for (const table of ddl.matchAll(/CREATE TABLE "public"\."([^"]+)" \(([\s\S]*?)\n  \);/g)) {
    const tableName = table[1];
    const body = table[2] ?? "";
    if (!tableName) continue;

    if (/"id" uuid PRIMARY KEY/.test(body)) {
      contracts.push(
        serialize({
          table: tableName,
          name: `${tableName}_pkey`,
          type: "p",
          localColumns: ["id"],
        }),
      );
    }

    for (const unique of body.matchAll(/CONSTRAINT "([^"]+)"\s+UNIQUE \(([^)]+)\)/g)) {
      if (!unique[1]) continue;
      contracts.push(
        serialize({
          table: tableName,
          name: unique[1],
          type: "u",
          localColumns: sqlIdentifierList(unique[2] ?? ""),
        }),
      );
    }

    for (const foreignKey of body.matchAll(
      /CONSTRAINT "([^"]+)"\s+FOREIGN KEY \(([^)]+)\)\s+REFERENCES "public"\."([^"]+)"\s*\(([^)]+)\)\s+ON DELETE (RESTRICT|CASCADE)/g,
    )) {
      if (!foreignKey[1] || !foreignKey[3]) continue;
      contracts.push(
        serialize({
          table: tableName,
          name: foreignKey[1],
          type: "f",
          localColumns: sqlIdentifierList(foreignKey[2] ?? ""),
          foreignTable: foreignKey[3],
          foreignColumns: sqlIdentifierList(foreignKey[4] ?? ""),
          deleteAction: foreignKey[5] === "CASCADE" ? "c" : "r",
        }),
      );
    }
  }

  return contracts.sort();
}

function createdCheckConstraintInventory(source: string): string[] {
  const checks: string[] = [];
  const ddl = source.slice(source.indexOf('ALTER TABLE "public"."producers"'));
  for (const table of ddl.matchAll(/CREATE TABLE "public"\."([^"]+)" \(([\s\S]*?)\n  \);/g)) {
    if (!table[1]) continue;
    for (const check of (table[2] ?? "").matchAll(/CONSTRAINT "([^"]+)"\s+CHECK \(/g)) {
      if (check[1]) checks.push(`${table[1]}|${check[1]}`);
    }
  }
  return checks.sort();
}

function namedCheckExpressions(source: string): Array<{ expression: string; name: string }> {
  const checks: Array<{ expression: string; name: string }> = [];

  for (const match of source.matchAll(/CONSTRAINT "([^"]+)"\s+CHECK\s*\(/g)) {
    const name = match[1];
    if (!name || match.index === undefined) continue;

    const openingParenthesis = match.index + match[0].length - 1;
    let depth = 1;
    let doubleQuoted = false;
    let singleQuoted = false;
    let closingParenthesis = -1;

    for (let index = openingParenthesis + 1; index < source.length; index += 1) {
      const current = source[index];
      const next = source[index + 1];

      if (singleQuoted) {
        if (current === "'" && next === "'") {
          index += 1;
        } else if (current === "'") {
          singleQuoted = false;
        }
        continue;
      }
      if (doubleQuoted) {
        if (current === '"' && next === '"') {
          index += 1;
        } else if (current === '"') {
          doubleQuoted = false;
        }
        continue;
      }
      if (current === "'") {
        singleQuoted = true;
        continue;
      }
      if (current === '"') {
        doubleQuoted = true;
        continue;
      }
      if (current === "(") depth += 1;
      if (current === ")") depth -= 1;
      if (depth === 0) {
        closingParenthesis = index;
        break;
      }
    }

    expect(closingParenthesis, name).toBeGreaterThan(openingParenthesis);
    checks.push({
      name,
      expression: source
        .slice(openingParenthesis + 1, closingParenthesis)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return checks;
}

function createdCheckConstraintContracts(source: string): string[] {
  const contracts: string[] = [];
  const ddl = source.slice(source.indexOf('ALTER TABLE "public"."producers"'));
  for (const table of ddl.matchAll(/CREATE TABLE "public"\."([^"]+)" \(([\s\S]*?)\n  \);/g)) {
    if (!table[1]) continue;
    for (const check of namedCheckExpressions(table[2] ?? "")) {
      contracts.push(`${table[1]}|${check.name}|${check.expression}`);
    }
  }
  return contracts.sort();
}

function expectedCheckConstraintContracts(source: string): string[] {
  const begin = source.indexOf("SKITZA_0027_EXPECTED_CHECK_CONTRACTS_BEGIN");
  const end = source.indexOf("SKITZA_0027_EXPECTED_CHECK_CONTRACTS_END");
  if (begin < 0 || end < begin) return [];

  const contracts: string[] = [];
  const expectedDdl = source.slice(begin, end);
  for (const table of expectedDdl.matchAll(
    /ALTER TABLE "skitza_0027_expected_([^"]+)"([\s\S]*?);/g,
  )) {
    if (!table[1]) continue;
    for (const check of namedCheckExpressions(table[2] ?? "")) {
      contracts.push(`${table[1]}|${check.name}|${check.expression}`);
    }
  }
  return contracts.sort();
}

function completedGateDigest(source: string, variable: string): string | undefined {
  return source.match(new RegExp(`${variable} CONSTANT text := '([0-9a-f]{32})'`))?.[1];
}

function sqlStringList(source: string): string[] {
  return [...source.matchAll(/'([^']+)'/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function sqlIdentifierList(source: string): string[] {
  return [...source.matchAll(/"([^"]+)"/g)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function criticalGateDefinitions(source: string): Array<{
  tableName: string;
  constraintName: string;
  constraintType: "f" | "u";
  localColumns: string[];
  foreignTableName: string | null;
  foreignColumns: string[];
}> {
  const definitions = [];
  const pattern =
    /\('([^']+)', '([^']+)', '([fu])', ARRAY\[([^\]]+)\]::text\[\], (NULL::text|'([^']+)'), (NULL::text\[\]|ARRAY\[([^\]]+)\]::text\[\])\)/g;

  for (const match of source.matchAll(pattern)) {
    const tableName = match[1];
    const constraintName = match[2];
    const constraintType = match[3];
    const localColumns = match[4];
    if (!tableName || !constraintName || !constraintType || !localColumns) continue;
    definitions.push({
      tableName,
      constraintName,
      constraintType: constraintType as "f" | "u",
      localColumns: sqlStringList(localColumns),
      foreignTableName: match[6] ?? null,
      foreignColumns: match[8] ? sqlStringList(match[8]) : [],
    });
  }
  return definitions;
}

const REVIEWED_SOURCE_TABLES = [
  "agreement_acceptances",
  "bookings",
  "client_contacts",
  "invoices",
  "notifications",
  "payment_proofs",
  "producers",
  "products",
  "project_tracks",
  "projects",
  "purchase_requests",
  "store_purchase_intents",
  "stripe_customers",
  "track_comments",
  "track_versions",
].sort();

const REVIEWED_SOURCE_CONSTRAINTS = [
  "agreement_acceptances|agreement_acceptances_client_contact_id_fkey",
  "agreement_acceptances|agreement_acceptances_pkey",
  "agreement_acceptances|agreement_acceptances_producer_id_fkey",
  "agreement_acceptances|agreement_acceptances_purchase_request_id_fkey",
  "bookings|bookings_pkey",
  "bookings|bookings_producer_id_producers_id_fk",
  "bookings|bookings_product_id_products_id_fk",
  "bookings|bookings_project_id_projects_id_fk",
  "bookings|bookings_song_id_fkey",
  "client_contacts|client_contacts_pkey",
  "client_contacts|client_contacts_producer_email_unique",
  "client_contacts|client_contacts_producer_id_producers_id_fk",
  "invoices|invoices_booking_id_bookings_id_fk",
  "invoices|invoices_legacy_purchase_proof_disabled",
  "invoices|invoices_payment_plan_project_id_projects_id_fk",
  "invoices|invoices_payment_proof_id_payment_proofs_id_fk",
  "invoices|invoices_pkey",
  "invoices|invoices_producer_id_producers_id_fk",
  "invoices|invoices_project_id_projects_id_fk",
  "invoices|invoices_purchase_request_id_fkey",
  "notifications|notifications_booking_id_bookings_id_fk",
  "notifications|notifications_comment_id_track_comments_id_fk",
  "notifications|notifications_pkey",
  "notifications|notifications_producer_id_producers_id_fk",
  "notifications|notifications_project_id_projects_id_fk",
  "notifications|notifications_purchase_request_id_fkey",
  "notifications|notifications_track_version_id_track_versions_id_fk",
  "payment_proofs|payment_proofs_amount_cents_check",
  "payment_proofs|payment_proofs_pkey",
  "payment_proofs|payment_proofs_private_docs_bucket_only",
  "payment_proofs|payment_proofs_producer_id_fkey",
  "payment_proofs|payment_proofs_project_id_fkey",
  "payment_proofs|payment_proofs_purchase_request_id_fkey",
  "payment_proofs|payment_proofs_size_bytes_check",
  "producers|producers_clerk_user_id_unique",
  "producers|producers_pkey",
  "producers|producers_slug_unique",
  "products|products_pkey",
  "products|products_producer_id_producers_id_fk",
  "project_tracks|project_tracks_pkey",
  "project_tracks|project_tracks_project_id_projects_id_fk",
  "projects|projects_booking_id_bookings_id_fk",
  "projects|projects_invite_token_unique",
  "projects|projects_pkey",
  "projects|projects_producer_id_producers_id_fk",
  "projects|projects_product_id_fkey",
  "purchase_requests|purchase_requests_booking_id_fkey",
  "purchase_requests|purchase_requests_client_contact_id_fkey",
  "purchase_requests|purchase_requests_pkey",
  "purchase_requests|purchase_requests_producer_id_fkey",
  "purchase_requests|purchase_requests_product_id_fkey",
  "purchase_requests|purchase_requests_project_id_fkey",
  "store_purchase_intents|store_purchase_intents_pkey",
  "store_purchase_intents|store_purchase_intents_producer_id_fk",
  "store_purchase_intents|store_purchase_intents_product_id_fk",
  "stripe_customers|stripe_customers_client_contact_id_client_contacts_id_fk",
  "stripe_customers|stripe_customers_producer_id_client_contact_id_pk",
  "stripe_customers|stripe_customers_producer_id_producers_id_fk",
  "track_comments|track_comments_pkey",
  "track_comments|track_comments_version_id_track_versions_id_fk",
  "track_versions|track_versions_pkey",
  "track_versions|track_versions_track_id_project_tracks_id_fk",
].sort();

const REVIEWED_SOURCE_INDEXES = [
  "agreement_acceptances|agreement_acceptances_request_unique",
  "client_contacts|client_contacts_clerk_user_idx",
  "invoices|invoices_payment_proof_unique",
  "invoices|invoices_producer_created_idx",
  "invoices|invoices_purchase_request_idx",
  "invoices|invoices_stripe_payment_intent_unique",
  "notifications|notifications_producer_active_idx",
  "payment_proofs|payment_proofs_one_pending_per_request",
  "payment_proofs|payment_proofs_producer_status_created_idx",
  "payment_proofs|payment_proofs_purchase_status_idx",
  "payment_proofs|payment_proofs_storage_key_unique",
  "purchase_requests|purchase_requests_contact_status_idx",
  "purchase_requests|purchase_requests_producer_status_idx",
  "purchase_requests|purchase_requests_ref_number_unique",
  "store_purchase_intents|store_purchase_intents_created_idx",
  "stripe_customers|stripe_customers_customer_idx",
].sort();

function sourceGate(source: string): string {
  const start = source.indexOf(
    "-- The migration is valid only against the reviewed pre-reset schema.",
  );
  const end = source.indexOf("SKITZA_0027_RESET_REQUIRED");
  expect(start).toBeGreaterThan(source.indexOf("RETURN;"));
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectedSourceColumnContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_source_columns");
  const start = source.lastIndexOf("FROM (VALUES", end);
  if (start < 0 || end < start) return [];
  return [...source.slice(start, end).matchAll(/^\s*\('([^']+)', '([^']*)'\),?$/gm)]
    .map((match) => `${match[1]}|${match[2]}`)
    .sort();
}

function expectedSourceConstraintInventory(source: string): string[] {
  const begin = source.indexOf("SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_BEGIN");
  const end = source.indexOf("SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_END");
  if (begin < 0 || end < begin) return [];
  const inventory: string[] = [];
  for (const table of source
    .slice(begin, end)
    .matchAll(/ALTER TABLE "skitza_0027_source_expected_([^"]+)"([\s\S]*?);/g)) {
    if (!table[1]) continue;
    for (const constraint of (table[2] ?? "").matchAll(/ADD CONSTRAINT "([^"]+)"/g)) {
      if (constraint[1]) inventory.push(`${table[1]}|${constraint[1]}`);
    }
  }
  return inventory.sort();
}

function expectedSourceCheckContracts(source: string): string[] {
  const begin = source.indexOf("SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_BEGIN");
  const end = source.indexOf("SKITZA_0027_EXPECTED_SOURCE_CONSTRAINTS_END");
  if (begin < 0 || end < begin) return [];
  const contracts: string[] = [];
  for (const table of source
    .slice(begin, end)
    .matchAll(/ALTER TABLE "skitza_0027_source_expected_([^"]+)"([\s\S]*?);/g)) {
    if (!table[1]) continue;
    for (const check of namedCheckExpressions(table[2] ?? "")) {
      contracts.push(`${table[1]}|${check.name}|${check.expression}`);
    }
  }
  return contracts.sort();
}

function expectedSourceIndexContracts(source: string): string[] {
  const start = source.indexOf("WITH expected_source_index(");
  const end = source.indexOf("),\n    actual_source_index AS", start);
  if (start < 0 || end < start) return [];
  return [
    ...source
      .slice(start, end)
      .matchAll(/\('([^']+)', '([^']+)', \$index\$([^$]+)\$index\$, (true|false), (true|false)\)/g),
  ]
    .map((match) => `${match[1]}|${match[2]}|${match[3]}|${match[4]}|${match[5]}`)
    .sort();
}

function expectedEnumContracts(source: string, alias: string): string[] {
  const end = source.indexOf(`) AS ${alias}`);
  const start = source.lastIndexOf("FROM (VALUES", end);
  if (start < 0 || end < start) return [];
  return [...source.slice(start, end).matchAll(/\('([^']+)', '([^']+)'\)/g)]
    .map((match) => `${match[1]}|${match[2]}`)
    .sort();
}

function expectedSourceTriggerContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_source_trigger");
  const start = source.lastIndexOf("FROM (VALUES", end);
  if (start < 0 || end < start) return [];
  return [
    ...source
      .slice(start, end)
      .matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*'([^']+)'\s*\)/g),
  ]
    .map((match) => `${match[1]}|${match[2]}|${match[3]}|${match[4]}|${match[5]}`)
    .sort();
}

function expectedSourceFunctionContracts(source: string): string[] {
  const end = source.indexOf(") AS expected_source_function");
  const start = source.lastIndexOf("FROM (VALUES", end);
  if (start < 0 || end < start) return [];
  return [...source.slice(start, end).matchAll(/\('([^']+)', '([0-9a-f]{32})'\)/g)]
    .map((match) => `${match[1]}|${match[2]}`)
    .sort();
}

describe("SK-90 purchase-level schema", () => {
  it("exports the approved project and purchase lifecycle enums", () => {
    expect(schema.projectLifecycleStatus.enumValues).toEqual([
      "waiting_for_payment",
      "active",
      "paused",
      "completed",
      "canceled",
    ]);
    expect(schema.purchaseLifecycleStatus.enumValues).toEqual([
      "waiting_for_payment",
      "active",
      "canceled",
    ]);
    expect(schema.purchasePaymentPlanKind.enumValues).toEqual(["full", "split_50_50", "monthly"]);
    expect(schema.purchaseInstallmentDueTrigger.enumValues).toEqual([
      "acceptance",
      "monthly_anniversary",
      "artist_approval",
    ]);
  });

  it("moves commercial ownership into purchase-level tables", () => {
    for (const exportName of [
      "purchases",
      "purchaseAcceptances",
      "purchaseInstallments",
      "paymentProofs",
      "purchasePayments",
      "purchasePaymentCorrections",
      "purchaseWaivers",
      "purchaseCancellations",
      "purchaseDownloadOverrideEvents",
      "purchaseSessionAllowances",
      "purchaseRequests",
      "privateOffers",
    ]) {
      expect(exportName in schema, exportName).toBe(true);
    }

    expect(schema.purchases.projectId.notNull).toBe(true);
    expect(schema.purchases.clientContactId.notNull).toBe(true);
    expect(schema.purchases.operationKey.notNull).toBe(true);
    expect(schema.purchases.operationDigest.notNull).toBe(true);
    expect(schema.purchases.commercialSnapshot.notNull).toBe(true);
    expect(schema.purchases.paymentPlanKind.notNull).toBe(false);
    expect(schema.purchaseInstallments.purchaseId.notNull).toBe(true);
    expect(schema.paymentProofs.installmentId.notNull).toBe(true);
    expect(schema.paymentProofs.replacesProofId.notNull).toBe(false);
    expect(schema.purchasePayments.purchaseId.notNull).toBe(true);
    expect(schema.purchasePayments.operationKey.notNull).toBe(true);
    expect(schema.purchasePayments.operationDigest.notNull).toBe(true);

    expect(getTableConfig(schema.purchases).checks.map((constraint) => constraint.name)).toContain(
      "purchases_zero_total_activation_shape",
    );
    expect(
      getTableConfig(schema.purchaseInstallments).checks.map((constraint) => constraint.name),
    ).toContain("purchase_installments_positive_amount");
    expect(getTableConfig(schema.purchases).checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "purchases_lifecycle_timestamp_shape",
        "purchases_snapshot_scalar_consistency",
        "purchases_agreement_text_shape",
        "purchases_source_amount_shape",
      ]),
    );
    expect(
      getTableConfig(schema.paymentProofs).checks.map((constraint) => constraint.name),
    ).toContain("payment_proofs_status_shape");
    expect(
      getTableConfig(schema.purchaseSessionAllowances).checks.map((constraint) => constraint.name),
    ).toContain("purchase_session_allowances_close_shape");
  });

  it("enforces exact frozen tax arithmetic in the purchase schema and migration", () => {
    expect(getTableConfig(schema.purchases).checks.map((constraint) => constraint.name)).toContain(
      "purchases_tax_shape",
    );

    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_tax_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_tax_shape|"),
    );

    expect(created).toBe(expected);
    expect(expected).toMatch(/tax_included.*round.*total_cents.*ratePct.*100.*ratePct/s);
    expect(expected).toMatch(/tax_added.*round.*subtotal_cents.*ratePct.*100/s);
    expect(expected).toMatch(/tax_free.*tax_cents.*0/s);
  });

  it("enforces the frozen list subtotal and explicit discount arithmetic", () => {
    expect(getTableConfig(schema.purchases).checks.map((constraint) => constraint.name)).toContain(
      "purchases_discount_shape",
    );

    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_discount_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_discount_shape|"),
    );

    expect(created).toBe(expected);
    expect(expected).toMatch(/listSubtotalCents.*discountCents.*subtotal_cents/s);
  });

  it("requires purchase source kinds and provenance links to stay consistent", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const purchaseChecks = getTableConfig(schema.purchases).checks.map(
      (constraint) => constraint.name,
    );
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_source_link_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_source_link_shape|"),
    );

    expect(purchaseChecks).toContain("purchases_source_link_shape");
    expect(created).toBe(expected);
    expect(expected).toMatch(
      /source_kind.*store_product.*session_product.*product_id.*IS NOT NULL.*purchase_request_id.*IS NOT NULL.*private_offer_id.*IS NULL.*source_kind.*private_offer.*private_offer_id.*IS NOT NULL.*purchase_request_id.*IS NULL/s,
    );

    const requiredRequestLink = '"purchase_request_id" IS NOT NULL';
    const sourceConstraintAt = sql.lastIndexOf('CONSTRAINT "purchases_source_link_shape"');
    const createdClauseAt = sql.indexOf(requiredRequestLink, sourceConstraintAt);
    expect(createdClauseAt).toBeGreaterThan(sql.indexOf("RETURN;"));
    const weakenedSameName = `${sql.slice(0, createdClauseAt)}"purchase_request_id" IS NULL${sql.slice(
      createdClauseAt + requiredRequestLink.length,
    )}`;
    expect(createdCheckConstraintContracts(weakenedSameName)).not.toEqual(
      expectedCheckConstraintContracts(completedGate),
    );
  });

  it("ties each unambiguous purchase source kind to its approved amount class", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const purchaseChecks = getTableConfig(schema.purchases).checks.map(
      (constraint) => constraint.name,
    );
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_source_amount_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_source_amount_shape|"),
    );

    expect(purchaseChecks).toContain("purchases_source_amount_shape");
    expect(created).toBe(expected);
    expect(expected).toMatch(
      /store_product.*session_product.*paid_add_on.*total_cents.*> 0.*no_charge_add_on.*total_cents.*= 0.*private_offer/s,
    );
  });

  it("requires every add-on to retain at least one explicit source anchor", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_source_link_shape|"),
    );

    expect(expected).toMatch(
      /paid_add_on.*no_charge_add_on.*product_id.*IS NOT NULL.*private_offer_id.*IS NOT NULL.*purchase_request_id.*IS NOT NULL/s,
    );
  });

  it("requires a non-empty string agreement in every frozen purchase snapshot", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const purchaseChecks = getTableConfig(schema.purchases).checks.map(
      (constraint) => constraint.name,
    );
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_agreement_text_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_agreement_text_shape|"),
    );

    expect(purchaseChecks).toContain("purchases_agreement_text_shape");
    expect(created).toBe(expected);
    expect(expected).toMatch(/jsonb_typeof.*agreementText.*string.*NULLIF.*btrim/s);
  });

  it("keeps terminal and purchase-linked request history immutable", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const requestChecks = getTableConfig(schema.purchaseRequests).checks.map(
      (constraint) => constraint.name,
    );
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchase_requests|purchase_requests_status_timestamp_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchase_requests|purchase_requests_status_timestamp_shape|"),
    );

    expect(requestChecks).toContain("purchase_requests_status_timestamp_shape");
    expect(created).toBe(expected);
    expect(expected).toMatch(
      /pending.*approved_at.*IS NULL.*converted.*converted_at.*IS NOT NULL/s,
    );
    expect(sql).toMatch(/SKITZA_PURCHASE_REQUEST_TERMINAL_HISTORY_IMMUTABLE/);
    expect(sql).toMatch(/SKITZA_PURCHASE_REQUEST_LINKED_HISTORY_IMMUTABLE/);
    expect(completedFunctionContracts(completedGate)).toEqual(createdFunctionContracts(sql));
  });

  it("binds nullable private-offer provenance and prevents post-acceptance drift", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const privateOfferUniqueNames = getTableConfig(schema.privateOffers).uniqueConstraints.map(
      (constraint) => constraint.name,
    );
    const purchaseForeignKeys = foreignKeyNames(schema.purchases);

    expect(privateOfferUniqueNames).toContain("private_offers_id_project_owner_unique");
    expect(privateOfferUniqueNames).not.toContain("private_offers_id_product_producer_unique");
    expect(purchaseForeignKeys).toEqual(
      expect.arrayContaining(["purchases_private_offer_project_owner_fk"]),
    );
    expect(purchaseForeignKeys).not.toContain("purchases_private_offer_product_producer_fk");
    expect(sql).toMatch(
      /validate_purchase_source_links[\s\S]*product_id" IS NOT DISTINCT FROM NEW\."product_id"[\s\S]*FOR KEY SHARE[\s\S]*SKITZA_PRIVATE_OFFER_SOURCE_MISMATCH/,
    );
    expect(sql).toMatch(
      /protect_private_offer_purchase_source[\s\S]*target_project_id[\s\S]*product_id[\s\S]*SKITZA_PRIVATE_OFFER_PURCHASE_SOURCE_IMMUTABLE/,
    );
    expect(completedTriggerContracts(completedGate)).toEqual(createdTriggerContracts(sql));
    expect(completedFunctionContracts(completedGate)).toEqual(createdFunctionContracts(sql));
  });

  it("keeps requests as a pre-acceptance queue without commercial or payment history", () => {
    expect(schema.purchaseRequestStatus.enumValues).toEqual([
      "pending",
      "approved",
      "declined",
      "canceled",
      "converted",
    ]);
    expect(schema.purchaseRequests.operationKey.notNull).toBe(true);
    expect(schema.purchaseRequests.projectId.notNull).toBe(false);
    expect(schema.purchases.purchaseRequestId.notNull).toBe(false);

    for (const removedField of [
      "priceCents",
      "paymentPlanSnapshot",
      "paymentPlanOptionsSnapshot",
      "royaltyTermsSnapshot",
      "agreementTextSnapshot",
    ]) {
      expect(removedField in schema.purchaseRequests, removedField).toBe(false);
    }
  });

  it("links songs, versions, sessions, approvals, and public links to a purchase", () => {
    expect(schema.projectTracks.purchaseId.notNull).toBe(true);
    expect(schema.projectTracks.archivedAt.name).toBe("archived_at");
    expect(schema.projectTracks.portfolioPublishedAt.name).toBe("portfolio_published_at");
    expect(schema.trackVersions.purchaseId.notNull).toBe(true);
    expect(schema.trackVersions.producerId.notNull).toBe(true);
    expect(schema.trackVersions.audioObjectEtag.notNull).toBe(false);
    expect(schema.trackVersions.audioIdentityFingerprint.notNull).toBe(false);
    expect(schema.trackComments.producerId.notNull).toBe(true);
    expect(schema.trackVersions.producerMarkedFinalAt.name).toBe("producer_marked_final_at");
    expect(schema.trackVersions.audioDeletedAt.name).toBe("audio_deleted_at");
    expect(schema.bookings.purchaseId.notNull).toBe(true);
    expect(schema.bookings.sessionAllowanceId.notNull).toBe(true);
    expect("versionApprovalEvents" in schema).toBe(true);
    expect(schema.versionApprovalEvents.audioIdentityFingerprint.notNull).toBe(true);
    expect("songPublicLinks" in schema).toBe(true);
    expect(
      getTableConfig(schema.trackVersions).checks.map((constraint) => constraint.name),
    ).toContain("track_versions_audio_identity_shape");
  });

  it("builds every composite tenant and artifact ownership constraint", () => {
    expect(foreignKeyNames(schema.projects)).toContain("projects_client_producer_fk");
    expect(foreignKeyNames(schema.purchases)).toContain("purchases_project_owner_fk");
    expect(foreignKeyNames(schema.projectTracks)).toContain("project_tracks_purchase_project_fk");
    expect(foreignKeyNames(schema.trackVersions)).toEqual(
      expect.arrayContaining([
        "track_versions_track_purchase_fk",
        "track_versions_purchase_producer_fk",
      ]),
    );
    expect(foreignKeyNames(schema.versionApprovalEvents)).toContain(
      "version_approval_events_audio_identity_fk",
    );
    expect(foreignKeyNames(schema.bookings)).toEqual(
      expect.arrayContaining([
        "bookings_purchase_project_fk",
        "bookings_purchase_producer_fk",
        "bookings_allowance_purchase_fk",
        "bookings_song_purchase_fk",
      ]),
    );
    expect(foreignKeyNames(schema.paymentProofs)).toContain(
      "payment_proofs_replacement_identity_fk",
    );
    expect(foreignKeyNames(schema.notifications)).toEqual(
      expect.arrayContaining([
        "notifications_project_producer_fk",
        "notifications_track_version_producer_fk",
        "notifications_comment_producer_fk",
        "notifications_booking_producer_fk",
        "notifications_purchase_request_producer_fk",
        "notifications_purchase_producer_fk",
      ]),
    );
    for (const reference of [
      schema.notifications.projectId,
      schema.notifications.trackVersionId,
      schema.notifications.commentId,
      schema.notifications.bookingId,
      schema.notifications.purchaseRequestId,
      schema.notifications.purchaseId,
    ]) {
      expect(reference.notNull).toBe(false);
    }
  });

  it("removes Milestone and direct-card schema models", () => {
    expect("invoices" in schema).toBe(false);
    expect("stripeCustomers" in schema).toBe(false);
    expect("depositPct" in schema.products).toBe(false);
    expect("depositModel" in schema.products).toBe(false);
    expect("milestones" in schema.products).toBe(false);
    expect("stripeAccountId" in schema.producers).toBe(false);
    expect("stripeChargesEnabled" in schema.producers).toBe(false);
    expect("tranzilaTerminalName" in schema.producers).toBe(false);
    expect("stripeCheckoutSessionId" in schema.bookings).toBe(false);
    expect("tranzilaConfirmationCode" in schema.bookings).toBe(false);
    expect("stripeSubscriptionScheduleId" in schema.projects).toBe(false);
    expect("paymentPlanKind" in schema.projects).toBe(false);
    expect("engagementTotalCents" in schema.projects).toBe(false);
  });
});

describe("SK-90 purchase foundation migration", () => {
  it("is one atomic, fail-closed top-level statement", () => {
    const sql = migrationSql();
    const statements = splitTopLevelStatements(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^--[\s\S]*DO \$migration\$/);

    const resetGuardAt = sql.indexOf("SKITZA_0027_RESET_REQUIRED");
    const catalogGuardAt = sql.indexOf("SKITZA_0027_DISALLOWED_CATALOG_STATE");
    const cardGuardAt = sql.indexOf("SKITZA_0027_LIVE_CARD_STATE");
    const firstCreateAt = sql.indexOf('CREATE TYPE "public"."project_lifecycle_status"');

    expect(resetGuardAt).toBeGreaterThanOrEqual(0);
    expect(catalogGuardAt).toBeGreaterThan(resetGuardAt);
    expect(cardGuardAt).toBeGreaterThan(catalogGuardAt);
    expect(firstCreateAt).toBeGreaterThan(cardGuardAt);
  });

  it("fails closed on an exact 15-table pre-reset source fingerprint", () => {
    const sql = migrationSql();
    const gate = sourceGate(sql);
    const resetGuardAt = sql.indexOf("SKITZA_0027_RESET_REQUIRED");
    const preservedEnums = [
      "notification_kind|comment_created,booking_requested,track_approved,purchase_requested,purchase_approved,purchase_declined,agreement_accepted,proof_submitted",
      "workflow_stage|brief,production,mixing,mastering,done",
    ];

    const sourceColumns = expectedSourceColumnContracts(gate);
    expect(sourceColumns.map((contract) => contract.split("|", 1)[0])).toEqual(
      REVIEWED_SOURCE_TABLES,
    );
    expect(expectedEnumContracts(gate, "expected_source_enum")).toEqual(preservedEnums);
    expect(expectedEnumContracts(sql.slice(0, sql.indexOf("RETURN;")), "expected_enum")).toEqual(
      expect.arrayContaining(preservedEnums),
    );
    expect(expectedSourceConstraintInventory(gate)).toEqual(REVIEWED_SOURCE_CONSTRAINTS);
    expect(
      expectedSourceIndexContracts(gate).map((contract) =>
        contract.split("|").slice(0, 2).join("|"),
      ),
    ).toEqual(REVIEWED_SOURCE_INDEXES);
    expect(expectedSourceTriggerContracts(gate)).toEqual([
      "purchase_requests|purchase_requests_freeze_session_count|freeze_purchase_request_session_count|23|product_id,song_qty",
    ]);
    expect(expectedSourceFunctionContracts(gate)).toEqual([
      "freeze_purchase_request_session_count|6e652d5b9ab618aa5d7ceec0b252e9bd",
    ]);

    expect(sql.lastIndexOf("SKITZA_0027_SOURCE_SCHEMA_DRIFT")).toBeLessThan(resetGuardAt);
    expect(resetGuardAt).toBeLessThan(
      sql.indexOf('DROP TABLE\n    "public"."agreement_acceptances"'),
    );
    expect(resetGuardAt).toBeLessThan(sql.indexOf('ALTER TABLE "public"."producers"'));
    expect(gate).toMatch(
      /pg_get_constraintdef\(actual_source_constraint\.oid, false\)[\s\S]*pg_get_constraintdef\(expected_source_constraint\.oid, false\)/,
    );
    expect(gate).toMatch(/pg_get_indexdef\(actual_source_index\.index_oid\)/);
    expect(gate).toMatch(/pg_index\.indnullsnotdistinct/);
    expect(gate).toMatch(/pg_get_expr\(\s*actual_source_trigger\.tgqual/);
    expect(gate).toMatch(/md5\(pg_proc\.prosrc\)/);
  });

  it("rejects weakened same-name source definitions before any approved reset mutation", () => {
    const sql = migrationSql();
    const gate = sourceGate(sql);
    const checks = expectedSourceCheckContracts(gate);
    const indexes = expectedSourceIndexContracts(gate);
    const triggers = expectedSourceTriggerContracts(gate);
    const functions = expectedSourceFunctionContracts(gate);
    const columns = expectedSourceColumnContracts(gate);

    expect(
      expectedSourceColumnContracts(
        gate.replace("audio_url:pg_catalog.text:YES", "audio_url:pg_catalog.uuid:YES"),
      ),
    ).not.toEqual(columns);

    expect(checks).toHaveLength(4);
    expect(
      expectedSourceCheckContracts(
        gate.replace('CHECK ("amount_cents" > 0)', 'CHECK ("amount_cents" >= 0)'),
      ),
    ).not.toEqual(checks);
    expect(
      expectedSourceIndexContracts(
        gate.replace(
          "CREATE UNIQUE INDEX payment_proofs_one_pending_per_request",
          "CREATE INDEX payment_proofs_one_pending_per_request",
        ),
      ),
    ).not.toEqual(indexes);
    expect(
      expectedSourceTriggerContracts(
        gate.replace(
          "        23,\n        'product_id,song_qty'",
          "        19,\n        'product_id,song_qty'",
        ),
      ),
    ).not.toEqual(triggers);
    expect(
      expectedSourceFunctionContracts(
        gate.replace("6e652d5b9ab618aa5d7ceec0b252e9bd", "00000000000000000000000000000000"),
      ),
    ).not.toEqual(functions);

    const enumContracts = expectedEnumContracts(gate, "expected_source_enum");
    expect(
      expectedEnumContracts(
        gate.replace("brief,production,mixing,mastering,done", "brief,production,done"),
        "expected_source_enum",
      ),
    ).not.toEqual(enumContracts);

    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const completedEnums = expectedEnumContracts(completedGate, "expected_enum");
    expect(
      expectedEnumContracts(
        completedGate.replace(
          "workflow_stage', 'brief,production,mixing,mastering,done",
          "workflow_stage', 'brief,production,done",
        ),
        "expected_enum",
      ),
    ).not.toEqual(completedEnums);
  });

  it("verifies the completed target contract before an idempotent return", () => {
    const sql = migrationSql();
    const returnAt = sql.indexOf("RETURN;");
    const driftAt = sql.indexOf("SKITZA_0027_TARGET_SCHEMA_DRIFT");

    expect(returnAt).toBeGreaterThan(driftAt);
    expect(sql.slice(0, returnAt)).toMatch(/information_schema\.columns/);
    expect(sql.slice(0, returnAt)).toMatch(/udt_schema \|\| '\.' \|\| udt_name/);
    expect(sql.slice(0, returnAt)).toMatch(/is_nullable/);
    expect(sql.slice(0, returnAt)).toMatch(/column_default/);
    expect(sql.slice(0, returnAt)).toMatch(/payment_proofs_does_not_replace_self/);
    expect(sql.slice(0, returnAt)).toMatch(/purchases_payment_plan_shape/);
    expect(sql.slice(0, returnAt)).toMatch(/payment_proofs_protect_evidence/);
    expect(sql.slice(0, returnAt)).toMatch(/purchase_payments_append_only/);
    expect(sql.slice(0, returnAt)).toMatch(/purchase_installment_due_trigger/);
    expect(sql.slice(0, returnAt)).toMatch(/monthly_anniversary/);
  });

  it("inventories every created constraint and index in the completed-target gate", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));

    expect(completedGateInventory(completedGate, "expected_constraint")).toEqual(
      createdConstraintInventory(sql),
    );
    expect(completedGateInventory(completedGate, "expected_index")).toEqual(
      createdIndexInventory(sql),
    );
    expect(completedGate).toMatch(/conrelid = to_regclass/);
    expect(completedGate).toMatch(/pg_index\.indrelid = to_regclass/);
    expect(completedIndexDefinitions(completedGate)).toEqual(createdIndexDefinitions(sql));
    expect(completedGate).toMatch(/pg_get_indexdef\(index_relation\.oid\)/);
    expect(completedGate).toMatch(/pg_index\.indisvalid/);
  });

  it("rejects extra completed-target objects and hashes every key constraint semantic", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const completedConstraints = createdConstraintInventory(sql).filter((contract) =>
      COMPLETED_TARGET_TABLES.has(contract.split("|")[0] ?? ""),
    );
    const triggerInventory = createdTriggerContracts(sql).map((contract) =>
      contract.split("|").slice(0, 2).join("|"),
    );
    const functionInventory = createdFunctionContracts(sql).map(
      (contract) => contract.split("|")[0] ?? "",
    );
    const keyConstraintContracts = createdKeyConstraintContracts(sql);

    expect(
      [
        ...keyConstraintContracts.map((contract) => contract.split("|").slice(0, 2).join("|")),
        ...createdCheckConstraintInventory(sql),
      ].sort(),
    ).toEqual(createdConstraintInventory(sql));

    expect({
      constraintInventory: completedGateDigest(sql, "expected_constraint_inventory_md5"),
      constraintStructure: completedGateDigest(sql, "expected_constraint_structure_md5"),
      functionInventory: completedGateDigest(sql, "expected_function_inventory_md5"),
      indexInventory: completedGateDigest(sql, "expected_index_inventory_md5"),
      triggerInventory: completedGateDigest(sql, "expected_trigger_inventory_md5"),
    }).toEqual({
      constraintInventory: inventoryDigest(completedConstraints),
      constraintStructure: inventoryDigest(keyConstraintContracts),
      functionInventory: inventoryDigest(functionInventory),
      indexInventory: inventoryDigest(createdIndexInventory(sql)),
      triggerInventory: inventoryDigest(triggerInventory),
    });

    expect(completedGate).toMatch(/pg_constraint\.confupdtype/);
    expect(completedGate).toMatch(/pg_constraint\.confdeltype/);
    expect(completedGate).toMatch(/pg_constraint\.confmatchtype/);
    expect(completedGate).toMatch(/pg_constraint\.condeferrable/);
    expect(completedGate).toMatch(/pg_constraint\.condeferred/);
    expect(completedGate).toMatch(/pg_index\.indnullsnotdistinct/);
    expect(completedGate).toMatch(/expected_constraint_inventory_md5/);
    expect(completedGate).toMatch(/expected_index_inventory_md5/);
    expect(completedGate).toMatch(/expected_trigger_inventory_md5/);
    expect(completedGate).toMatch(/expected_function_inventory_md5/);
    expect(completedGate.match(/COLLATE "C"/g)).toHaveLength(9);

    expect(
      inventoryDigest([...completedConstraints, "purchases|lookalike_extra_constraint"]),
    ).not.toBe(completedGateDigest(sql, "expected_constraint_inventory_md5"));
    expect(
      inventoryDigest([...createdIndexInventory(sql), "purchases|lookalike_extra_index"]),
    ).not.toBe(completedGateDigest(sql, "expected_index_inventory_md5"));
    expect(inventoryDigest([...triggerInventory, "purchases|lookalike_extra_trigger"])).not.toBe(
      completedGateDigest(sql, "expected_trigger_inventory_md5"),
    );
    expect(inventoryDigest([...functionInventory, "lookalike_extra_function"])).not.toBe(
      completedGateDigest(sql, "expected_function_inventory_md5"),
    );

    const expectedStructure = completedGateDigest(sql, "expected_constraint_structure_md5");
    for (const [fieldIndex, wrongValue] of [
      [3, "wrong_local_column"],
      [4, "wrong_foreign_table"],
      [5, "wrong_foreign_column"],
      [6, "c"],
      [7, "c"],
      [8, "f"],
      [9, "true"],
      [10, "true"],
      [11, "false"],
      [12, "true"],
    ] as const) {
      const wrongForeignKey = [...keyConstraintContracts];
      const foreignKeyIndex = wrongForeignKey.findIndex((contract) => contract.includes("|f|"));
      const fields = wrongForeignKey[foreignKeyIndex]?.split("|");
      expect(fields).toBeDefined();
      if (!fields) continue;
      fields[fieldIndex] = wrongValue;
      wrongForeignKey[foreignKeyIndex] = fields.join("|");
      expect(inventoryDigest(wrongForeignKey), `${fieldIndex}:${wrongValue}`).not.toBe(
        expectedStructure,
      );
    }

    const wrongUnique = [...keyConstraintContracts];
    const uniqueIndex = wrongUnique.findIndex((contract) => contract.includes("|u|"));
    const uniqueFields = wrongUnique[uniqueIndex]?.split("|");
    expect(uniqueFields).toBeDefined();
    if (uniqueFields) {
      uniqueFields[17] = "true";
      wrongUnique[uniqueIndex] = uniqueFields.join("|");
    }
    expect(inventoryDigest(wrongUnique)).not.toBe(expectedStructure);
  });

  it("fingerprints every completed CHECK definition and rejects same-name drift", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const createdChecks = createdCheckConstraintContracts(sql);
    const expectedChecks = expectedCheckConstraintContracts(completedGate);

    expect(expectedChecks).toEqual(createdChecks);
    expect(completedGate).toMatch(
      /pg_get_constraintdef\(actual_check\.oid, false\)\s*=\s*pg_get_constraintdef\(expected_check\.oid, false\)/,
    );
    expect(completedGate).toMatch(/actual_check\.convalidated/);
    expect(completedGate).toMatch(/NOT actual_check\.connoinherit/);

    const approvedDefinition =
      'CONSTRAINT "purchase_payments_positive_amount" CHECK ("amount_cents" > 0)';
    const realDefinitionAt = sql.lastIndexOf(approvedDefinition);
    expect(realDefinitionAt).toBeGreaterThan(
      sql.indexOf("SKITZA_0027_EXPECTED_CHECK_CONTRACTS_END"),
    );
    const weakenedSql = `${sql.slice(0, realDefinitionAt)}${approvedDefinition.replace(
      "> 0",
      ">= 0",
    )}${sql.slice(realDefinitionAt + approvedDefinition.length)}`;
    const weakenedSameName = createdCheckConstraintContracts(weakenedSql);
    expect(weakenedSameName).not.toEqual(expectedChecks);
  });

  it("allows manual payments with optional proof but requires proof for proof-sourced payments", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const expectedChecks = expectedCheckConstraintContracts(completedGate);
    const createdChecks = createdCheckConstraintContracts(sql);
    const expectedContract = expectedChecks.find((contract) =>
      contract.startsWith("purchase_payments|purchase_payments_source_proof_consistency|"),
    );
    const createdContract = createdChecks.find((contract) =>
      contract.startsWith("purchase_payments|purchase_payments_source_proof_consistency|"),
    );

    expect(createdContract).toBe(expectedContract);
    expect(expectedContract).toContain(
      `"source" = 'manual' OR ("source" = 'proof' AND "proof_id" IS NOT NULL)`,
    );

    const accepts = (source: "manual" | "proof", proofId: string | null): boolean =>
      source === "manual" || (source === "proof" && proofId !== null);
    expect(accepts("manual", null)).toBe(true);
    expect(accepts("manual", "private-proof")).toBe(true);
    expect(accepts("proof", null)).toBe(false);
    expect(accepts("proof", "private-proof")).toBe(true);

    const approvedManualClause = `"source" = 'manual'`;
    const createdClauseAt = sql.lastIndexOf(approvedManualClause);
    expect(createdClauseAt).toBeGreaterThan(sql.indexOf("RETURN;"));
    const sameNameOldContract = `${sql.slice(0, createdClauseAt)}("source" = 'manual' AND "proof_id" IS NULL)${sql.slice(
      createdClauseAt + approvedManualClause.length,
    )}`;
    expect(createdCheckConstraintContracts(sameNameOldContract)).not.toEqual(expectedChecks);
  });

  it("rejects same-named column, index, trigger, and function lookalikes before RETURN", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));

    expect(completedColumnContracts(completedGate)).toEqual(createdColumnContracts(sql));
    expect(completedTriggerContracts(completedGate)).toEqual(createdTriggerContracts(sql));
    expect(completedFunctionContracts(completedGate)).toEqual(createdFunctionContracts(sql));

    expect(
      createdColumnContracts(sql.replace('"purchase_id" uuid NOT NULL', '"purchase_id" text')),
    ).not.toEqual(completedColumnContracts(completedGate));
    expect(
      createdIndexDefinitions(
        sql.replace(
          'CREATE UNIQUE INDEX "purchases_private_offer_unique"',
          'CREATE INDEX "purchases_private_offer_unique"',
        ),
      ),
    ).not.toEqual(completedIndexDefinitions(completedGate));
    expect(
      createdTriggerContracts(
        sql.replace(
          'BEFORE INSERT ON "public"."purchase_acceptances"',
          'BEFORE UPDATE ON "public"."purchase_acceptances"',
        ),
      ),
    ).not.toEqual(completedTriggerContracts(completedGate));
    expect(
      createdFunctionContracts(
        sql.replace("SKITZA_PAYMENT_PROOF_TERMINAL_IMMUTABLE", "SKITZA_PAYMENT_PROOF_LOOKALIKE"),
      ),
    ).not.toEqual(completedFunctionContracts(completedGate));

    expect(completedGate).toMatch(/tgtype = expected_trigger\."trigger_type"::smallint/);
    expect(completedGate).toMatch(/md5\(pg_proc\.prosrc\)/);
  });

  it("requires the previously omitted ownership constraints before an idempotent return", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const inventory = new Set(completedGateInventory(completedGate, "expected_constraint"));

    for (const required of [
      "products|products_id_producer_unique",
      "client_contacts|client_contacts_id_producer_unique",
      "bookings|bookings_purchase_producer_fk",
      "bookings|bookings_song_purchase_fk",
      "payment_proofs|payment_proofs_purchase_owner_fk",
      "payment_proofs|payment_proofs_installment_purchase_currency_fk",
      "purchase_acceptances|purchase_acceptances_purchase_owner_fk",
      "purchase_acceptances|purchase_acceptances_purchase_snapshot_fk",
      "purchase_session_allowances|purchase_session_allowances_purchase_producer_fk",
      "purchase_cancellations|purchase_cancellations_purchase_producer_fk",
    ]) {
      expect(inventory.has(required), required).toBe(true);
    }

    expect(completedGate).toMatch(/critical_constraint/);
    expect(completedGate).toMatch(/unnest\(pg_constraint\.conkey\) WITH ORDINALITY/);
    expect(completedGate).toMatch(/unnest\(pg_constraint\.confkey\) WITH ORDINALITY/);
    expect(completedGate).toMatch(
      /purchases_payment_plan_shape[\s\S]*total_cents = 0\.\*payment_plan_kind IS NULL/,
    );
    expect(completedGate).toMatch(
      /purchases_zero_total_activation_shape[\s\S]*total_cents > 0\.\*lifecycle_status\.\*active\.\*canceled\.\*activated_at = accepted_at/,
    );
    expect(completedGate).toMatch(/purchase_installments_positive_amount[\s\S]*amount_cents > 0/);
    expect(completedGate).toMatch(
      /payment_proofs_replacement_identity_fk[\s\S]*replaces_proof_id[\s\S]*installment_id/,
    );
  });

  it("keeps every critical no-op constraint definition aligned with its created DDL", () => {
    const sql = migrationSql();
    const definitions = criticalGateDefinitions(sql.slice(0, sql.indexOf("RETURN;")));
    expect(definitions.length).toBeGreaterThan(20);

    for (const expected of definitions) {
      const constraintAt = sql.indexOf(`CONSTRAINT "${expected.constraintName}"`);
      expect(constraintAt, expected.constraintName).toBeGreaterThanOrEqual(0);
      const definition = sql.slice(constraintAt, constraintAt + 700);

      if (expected.constraintType === "u") {
        const unique = definition.match(/UNIQUE \(([^)]+)\)/);
        expect(unique?.[1], expected.constraintName).toBeDefined();
        expect(sqlIdentifierList(unique?.[1] ?? ""), expected.constraintName).toEqual(
          expected.localColumns,
        );
        continue;
      }

      const foreignKey = definition.match(
        /FOREIGN KEY \(([^)]+)\)\s+REFERENCES "public"\."([^"]+)"\(([^)]+)\)\s+ON DELETE RESTRICT/,
      );
      expect(foreignKey, expected.constraintName).not.toBeNull();
      expect(sqlIdentifierList(foreignKey?.[1] ?? ""), expected.constraintName).toEqual(
        expected.localColumns,
      );
      expect(foreignKey?.[2], expected.constraintName).toBe(expected.foreignTableName);
      expect(sqlIdentifierList(foreignKey?.[3] ?? ""), expected.constraintName).toEqual(
        expected.foreignColumns,
      );
    }
  });

  it("rejects completed targets that retain removed legacy types or functions", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));

    expect(completedGate).toContain("to_regtype('public.invoice_status') IS NOT NULL");
    expect(completedGate).toContain("to_regtype('public.project_stage') IS NOT NULL");
    expect(completedGate).toContain(
      "to_regprocedure('public.freeze_purchase_request_session_count()') IS NOT NULL",
    );
  });

  it("creates concurrent dedupe and composite ownership constraints", () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /purchases_operation_key_unique[\s\S]*producer_id[\s\S]*client_contact_id[\s\S]*operation_key/,
    );
    expect(sql).toMatch(/project_tracks_purchase_project_fk/);
    expect(sql).toMatch(/track_versions_track_purchase_fk/);
    expect(sql).toMatch(/bookings_purchase_project_fk/);
    expect(sql).toMatch(/payment_proofs_installment_purchase_currency_fk/);
    expect(sql).toMatch(/payment_proofs_replacement_identity_fk/);
    expect(sql).toMatch(/payment_proofs_does_not_replace_self/);
    expect(sql).toMatch(/purchase_payments_installment_purchase_currency_fk/);
    expect(sql).toMatch(/purchase_payments_proof_purchase_installment_currency_fk/);
    expect(sql).toMatch(/purchase_payments_operation_key_unique/);
    expect(sql).toMatch(/purchases_payment_plan_shape/);
    expect(sql).toMatch(/purchases_zero_total_activation_shape/);
    expect(sql).toMatch(/purchase_installments_positive_amount/);
    expect(sql).toMatch(/purchase_installments_require_paid_purchase/);
    expect(sql).toMatch(/SKITZA_INSTALLMENT_REQUIRES_PAID_PURCHASE/);
    expect(sql).toMatch(/ON DELETE RESTRICT/gi);
  });

  it("enforces true zero-total activation and rejects any zero-total installment path", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));

    expect(sql).toMatch(
      /purchases_zero_total_activation_shape[\s\S]*total_cents[\s\S]*lifecycle_status[\s\S]*activated_at[\s\S]*accepted_at/,
    );
    expect(sql).toMatch(/purchase_installments_positive_amount[\s\S]*CHECK \("amount_cents" > 0\)/);
    expect(sql).toMatch(
      /require_paid_purchase_for_installment[\s\S]*total_cents" > 0[\s\S]*SKITZA_INSTALLMENT_REQUIRES_PAID_PURCHASE/,
    );
    expect(completedGate).toMatch(
      /purchase_installments_require_paid_purchase[\s\S]*require_paid_purchase_for_installment/,
    );
    expect(completedGate).toMatch(/tgfoid = to_regprocedure/);
    expect(completedGate).toMatch(/tgenabled = 'O'/);
  });

  it("defers exact installment schedule validation and seals accepted debt", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));

    expect(sql).toMatch(
      /validate_purchase_installment_schedule[\s\S]*expected_installment_count[\s\S]*selectedPaymentPlan[\s\S]*installments/,
    );
    expect(sql).toMatch(
      /installment_count[\s\S]*installment_sum[\s\S]*activation_installment_count[\s\S]*invalid_amount_count/,
    );
    expect(sql).toMatch(
      /base_installment_amount[\s\S]*installment_remainder[\s\S]*amount_cents[\s\S]*position[\s\S]*SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID/,
    );
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(3);
    expect(sql).toMatch(
      /reject_purchase_installment_after_acceptance[\s\S]*FOR UPDATE[\s\S]*purchase_acceptances[\s\S]*SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_SEALED/,
    );
    expect(completedTriggerContracts(completedGate)).toEqual(createdTriggerContracts(sql));
    expect(completedFunctionContracts(completedGate)).toEqual(createdFunctionContracts(sql));
  });

  it("closes nullable CHECK-expression holes with explicit truth", () => {
    const sql = migrationSql();
    for (const name of [
      "purchases_zero_total_activation_shape",
      "purchases_lifecycle_timestamp_shape",
      "purchase_session_allowances_limit_shape",
    ]) {
      const start = sql.indexOf(`CONSTRAINT "${name}"`);
      const next = sql.indexOf('\n    CONSTRAINT "', start + 1);
      expect(start, name).toBeGreaterThanOrEqual(0);
      expect(sql.slice(start, next === -1 ? undefined : next), name).toMatch(/\bIS TRUE\b/);
    }
  });

  it("guards immutable accepted history and monotonic lifecycle fields", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/purchases_protect_commercial_snapshot/);
    expect(sql).toMatch(/purchase_installments_protect_terms/);
    expect(sql).toMatch(/payment_proofs_protect_evidence/);
    expect(sql).toMatch(/SKITZA_PAYMENT_PROOF_TERMINAL_IMMUTABLE/);
    expect(sql).toMatch(/payment_proofs_status_shape/);
    expect(sql).toMatch(/payment_proofs_validate_replacement/);
    expect(sql).toMatch(/payment_proofs_replaces_proof_unique/);
    expect(sql).toMatch(/purchase_session_allowances_protect_terms/);
    expect(sql).toMatch(/SKITZA_SESSION_ALLOWANCE_CLOSURE_IMMUTABLE/);
    expect(sql).toMatch(/purchase_session_allowances_close_shape/);
    expect(sql).toMatch(/purchase_payments_append_only/);
    expect(sql).toMatch(/purchase_payment_corrections_append_only/);
    expect(sql).toMatch(/purchase_waivers_append_only/);
    expect(sql).toMatch(/purchase_cancellations_append_only/);
    expect(sql).toMatch(/projects_protect_owner/);
    expect(sql).toMatch(/purchase_requests_protect_identity/);
    expect(sql).toMatch(/project_tracks_protect_identity/);
    expect(sql).toMatch(/track_versions_protect_identity/);
    expect(sql).toMatch(/bookings_protect_identity/);
    expect(sql).toMatch(/SKITZA_PURCHASE_LIFECYCLE_TRANSITION_FORBIDDEN/);
    expect(sql).toMatch(/SKITZA_PURCHASE_INSTALLMENT_DUE_AT_IMMUTABLE/);
    expect(sql).toMatch(/SKITZA_PURCHASE_INSTALLMENT_TERMINAL_STATUS_IMMUTABLE/);
    expect(sql).toMatch(/purchase_acceptances_validate_purchase/);
    expect(sql).toMatch(/SKITZA_ACCEPTANCE_MUST_MATCH_PURCHASE_SNAPSHOT/);
  });

  it("keeps direct cancellation from inventing activation history", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const expected = expectedCheckConstraintContracts(completedGate).find((contract) =>
      contract.startsWith("purchases|purchases_lifecycle_timestamp_shape|"),
    );
    const created = createdCheckConstraintContracts(sql).find((contract) =>
      contract.startsWith("purchases|purchases_lifecycle_timestamp_shape|"),
    );

    expect(created).toBe(expected);
    expect(expected).toMatch(
      /lifecycle_status.*canceled.*activated_at.*IS NULL.*canceled_at.*>=.*accepted_at.*activated_at.*>=.*accepted_at.*canceled_at.*>=.*activated_at/s,
    );
    expect(sql).toMatch(
      /OLD\."lifecycle_status" = 'waiting_for_payment'[\s\S]*NEW\."lifecycle_status" = 'canceled'[\s\S]*NEW\."activated_at" IS NOT NULL[\s\S]*SKITZA_PURCHASE_CANCELED_BEFORE_ACTIVATION/,
    );
    expect(completedFunctionContracts(completedGate)).toEqual(createdFunctionContracts(sql));
  });

  it("allows only a same-owner project correction before request conversion", () => {
    const sql = migrationSql();
    const functionStart = sql.indexOf(
      'CREATE FUNCTION "public"."protect_purchase_request_identity"()',
    );
    const functionEnd = sql.indexOf(
      'CREATE TRIGGER "purchase_requests_protect_identity"',
      functionStart,
    );
    const requestIdentityFunction = sql.slice(functionStart, functionEnd);

    expect(requestIdentityFunction).toMatch(/OLD\."project_id" IS DISTINCT FROM NEW\."project_id"/);
    expect(requestIdentityFunction).toMatch(/OLD\."status" NOT IN \('pending', 'approved'\)/);
    expect(requestIdentityFunction).toMatch(/NEW\."status" IS DISTINCT FROM OLD\."status"/);
    expect(requestIdentityFunction).toMatch(/OLD\."converted_at" IS NOT NULL/);
    expect(requestIdentityFunction).toMatch(/FROM "public"\."purchases"/);
    expect(requestIdentityFunction).toMatch(
      /target_project\."producer_id" = OLD\."producer_id"[\s\S]*target_project\."client_contact_id" = OLD\."client_contact_id"/,
    );
    expect(requestIdentityFunction).toMatch(/SKITZA_PURCHASE_REQUEST_PROJECT_CORRECTION_FORBIDDEN/);
    expect(requestIdentityFunction).not.toMatch(
      /OLD\."product_id", OLD\."project_id"[\s\S]*NEW\."product_id", NEW\."project_id"/,
    );
    expect(sql).toMatch(
      /purchases_purchase_request_owner_fk[\s\S]*purchase_request_id", "product_id", "project_id", "producer_id", "client_contact_id[\s\S]*purchase_requests[\s\S]*"id", "product_id", "project_id", "producer_id", "client_contact_id"/,
    );
  });

  it("allows one live-placeholder completion and then freezes audio identity and deletion", () => {
    const sql = migrationSql();
    const completedGate = sql.slice(0, sql.indexOf("RETURN;"));
    const trackVersionGuardStart = sql.indexOf(
      'CREATE FUNCTION "public"."protect_track_version_identity"()',
    );
    const trackVersionGuardEnd = sql.indexOf(
      'CREATE TRIGGER "track_versions_protect_identity"',
      trackVersionGuardStart,
    );
    const trackVersionGuard = sql.slice(trackVersionGuardStart, trackVersionGuardEnd);

    expect(sql).toMatch(/track_versions_audio_identity_unique/);
    expect(sql).toMatch(/track_versions_audio_identity_shape/);
    expect(sql).toMatch(
      /track_versions_audio_identity_shape[\s\S]*audio_url" IS NULL[\s\S]*audio_identity_fingerprint[\s\S]*audio_url" IS NOT NULL[\s\S]*encode\(sha256\(convert_to[\s\S]*octet_length\("audio_r2_key"\)[\s\S]*audio_object_etag[\s\S]*size_bytes/,
    );
    expect(sql).toMatch(
      /version_approval_events_audio_identity_fk[\s\S]*audio_identity_fingerprint/,
    );
    expect(trackVersionGuard).not.toMatch(/version_approval_events/);
    expect(trackVersionGuard).toMatch(/old_is_placeholder boolean/);
    expect(trackVersionGuard).toMatch(/new_is_completed boolean/);
    expect(trackVersionGuard).toMatch(/identity_changed boolean/);
    expect(trackVersionGuard).toMatch(
      /OLD\."audio_deleted_at" IS NOT NULL[\s\S]*NEW\."audio_deleted_at" IS DISTINCT FROM OLD\."audio_deleted_at"[\s\S]*SKITZA_TRACK_VERSION_AUDIO_DELETION_IMMUTABLE/,
    );
    expect(trackVersionGuard).toMatch(
      /IF identity_changed[\s\S]*IF NOT old_is_placeholder[\s\S]*SKITZA_TRACK_VERSION_AUDIO_IDENTITY_IMMUTABLE/,
    );
    expect(trackVersionGuard).toMatch(
      /OLD\."audio_deleted_at" IS NOT NULL[\s\S]*NEW\."audio_deleted_at" IS NOT NULL[\s\S]*NOT new_is_completed[\s\S]*SKITZA_TRACK_VERSION_AUDIO_IDENTITY_TRANSITION_FORBIDDEN/,
    );
    expect(trackVersionGuard).toMatch(
      /old_is_placeholder := OLD\."audio_url" IS NULL[\s\S]*OLD\."audio_identity_fingerprint" IS NULL/,
    );
    expect(trackVersionGuard).toMatch(
      /new_is_completed := NEW\."audio_url" IS NOT NULL[\s\S]*NEW\."audio_identity_fingerprint" IS NOT NULL/,
    );

    const expectedChecks = expectedCheckConstraintContracts(completedGate);
    const approvedPlaceholder =
      '"audio_url" IS NULL AND "audio_r2_key" IS NULL AND "size_bytes" IS NULL';
    const createdPlaceholderAt = sql.lastIndexOf(approvedPlaceholder);
    expect(createdPlaceholderAt).toBeGreaterThan(sql.indexOf("RETURN;"));
    const weakenedSameName = `${sql.slice(0, createdPlaceholderAt)}${approvedPlaceholder.replace(
      '"audio_url" IS NULL AND ',
      "",
    )}${sql.slice(createdPlaceholderAt + approvedPlaceholder.length)}`;
    expect(createdCheckConstraintContracts(weakenedSameName)).not.toEqual(expectedChecks);
  });

  it("binds every nullable notification reference to its producer", () => {
    const sql = migrationSql();

    for (const constraint of [
      "notifications_project_producer_fk",
      "notifications_track_version_producer_fk",
      "notifications_comment_producer_fk",
      "notifications_booking_producer_fk",
      "notifications_purchase_request_producer_fk",
      "notifications_purchase_producer_fk",
    ]) {
      expect(sql, constraint).toMatch(new RegExp(`${constraint}[\\s\\S]*producer_id`));
    }
  });

  it("contains no reset, backfill, or synthetic purchase mutation", () => {
    const sql = migrationSql();
    const sqlWithoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(sqlWithoutComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlWithoutComments).not.toMatch(/\bINSERT\s+INTO\s+"?purchases"?\b/i);
    expect(sqlWithoutComments).not.toMatch(
      /\bUPDATE\s+"?(?:projects|purchase_requests|invoices)"?\b/i,
    );
    const droppedTables = sqlWithoutComments.match(/DROP\s+TABLE[\s\S]*?;/i)?.[0] ?? "";
    expect(droppedTables).not.toMatch(
      /"(?:producers|products|client_contacts|availability_blocks|availability_blackouts|portfolio_tracks|producer_external_links|producer_notes)"/i,
    );
  });
});
