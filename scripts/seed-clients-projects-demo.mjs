// scripts/seed-clients-projects-demo.mjs
//
// Inserts realistic demo data into the dev/preview DB so the new
// Clients & Projects redesign (PR #117) has something to show in QA.
// All inserted rows are prefixed with "DEMO " in the name so they
// can be wiped after QA.
//
// What it creates (idempotent — re-running is safe, it skips rows
// that already exist):
//   • 6 client_contacts with varied LinkPill states:
//       2 "active" (clerk_user_id set — Linked pill, green)
//       2 "pending" (invited_at set — Invited pill, amber)
//       2 "none" (neither — Invite-to-app CTA)
//   • 10 projects across the 6 clients, with:
//       - Varied stages (lead / booked / in_production / final_review / paid / archived)
//       - Mix of deposit-paid / final-paid / outstanding balances
//       - bookings linking each project to one of the producer's
//         existing products (for realistic priceCents → outstanding)
//       - position values 0..9 so drag-to-reorder works visibly
//
// Requirements:
//   1. DATABASE_URL env var pointing at the dev/preview Neon DB
//      (prefer the UNPOOLED variant — see apply-migrations.mjs)
//   2. The producer must have at least ONE product in the products
//      table (the script copies price + currency from the first one)
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/seed-clients-projects-demo.mjs
//
// Optional flags:
//   --producer-email <email>   Pick a specific producer. Default = first.
//   --cleanup                  Delete all DEMO-prefixed rows. Run AFTER QA.

import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// Hash email the same way the app does (see server/artist/identity.ts):
// sha256 of the lowercased email, hex-encoded. Hashing client-side
// avoids depending on the Postgres `pgcrypto` extension.
function emailHashFor(email) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

const args = process.argv.slice(2);
const cleanup = args.includes("--cleanup");
const emailFlagIdx = args.indexOf("--producer-email");
const producerEmail = emailFlagIdx >= 0 ? args[emailFlagIdx + 1] : null;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  console.error(
    "Hint: pull the UNPOOLED url from the Neon console (PgBouncer can choke on DDL).",
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// ─── Find producer ─────────────────────────────────────────────────
const producerQuery = producerEmail
  ? await sql`SELECT id, email, slug FROM producers WHERE email = ${producerEmail} LIMIT 1`
  : await sql`SELECT id, email, slug FROM producers ORDER BY created_at ASC LIMIT 1`;

const producer = producerQuery[0];
if (!producer) {
  console.error(
    producerEmail
      ? `Producer not found for email: ${producerEmail}`
      : "No producers in this database. Create one first via /sign-up.",
  );
  process.exit(1);
}

console.log(`Producer: ${producer.email} (id=${producer.id}, slug=${producer.slug})`);

// ─── Cleanup mode ──────────────────────────────────────────────────
if (cleanup) {
  console.log("Cleanup mode — deleting DEMO rows…");
  // Bookings cascade off projects; project_tracks/track_versions cascade off projects.
  // client_contacts deletes after projects so the project FK to email is OK.
  const projectsDel = await sql`
    DELETE FROM projects
    WHERE producer_id = ${producer.id}
      AND title LIKE 'DEMO %'
    RETURNING id
  `;
  const contactsDel = await sql`
    DELETE FROM client_contacts
    WHERE producer_id = ${producer.id}
      AND name LIKE 'DEMO %'
    RETURNING id
  `;
  console.log(
    `Cleaned up: ${projectsDel.length} projects, ${contactsDel.length} contacts.`,
  );
  process.exit(0);
}

// ─── Find a product to copy pricing from ──────────────────────────
const products = await sql`
  SELECT id, name, price_cents, currency
  FROM products
  WHERE producer_id = ${producer.id} AND archived_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1
`;
const product = products[0];
if (!product) {
  console.error(
    "This producer has no products yet. The seed script needs at least one\n" +
      "product to copy price/currency from. Create one in the Store first.",
  );
  process.exit(1);
}
console.log(
  `Using product: ${product.name} (${product.price_cents / 100} ${product.currency})`,
);

// ─── Mock client contacts ──────────────────────────────────────────
// Names + emails are fictional. emailHash is sha256(lowercased email),
// computed by the DB itself via a small inline expression below so the
// script doesn't need to import a hashing helper.
//
// invited_at = X means the producer sent an invite at time X.
// clerk_user_id = "demo_clerk_XX" simulates an artist who signed up.

const NOW = new Date();
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const CLIENTS = [
  {
    name: "DEMO Noa Kirel",
    email: "demo+noa@skitza.app",
    invitedAt: daysAgo(14),
    clerkUserId: "demo_clerk_noa",
    tags: ["pop", "label: Universal"],
    referralSource: "Instagram",
    lastSeenAt: daysAgo(1),
    position: 0,
  },
  {
    name: "DEMO Tamar Eisenberg",
    email: "demo+tamar@skitza.app",
    invitedAt: daysAgo(7),
    clerkUserId: "demo_clerk_tamar",
    tags: ["indie", "singer-songwriter"],
    referralSource: "Word of mouth",
    lastSeenAt: daysAgo(3),
    position: 1,
  },
  {
    name: "DEMO Maya Levin",
    email: "demo+maya@skitza.app",
    invitedAt: daysAgo(3),
    clerkUserId: null,
    tags: ["hip-hop"],
    referralSource: "Tiktok",
    lastSeenAt: daysAgo(3),
    position: 2,
  },
  {
    name: "DEMO Eden Hassan",
    email: "demo+eden@skitza.app",
    invitedAt: daysAgo(1),
    clerkUserId: null,
    tags: ["electronic"],
    referralSource: null,
    lastSeenAt: daysAgo(1),
    position: 3,
  },
  {
    name: "DEMO Yossi Bar",
    email: "demo+yossi@skitza.app",
    invitedAt: null,
    clerkUserId: null,
    tags: [],
    referralSource: "Cold outreach",
    lastSeenAt: daysAgo(28),
    position: 4,
  },
  {
    name: "DEMO Liat Goren",
    email: "demo+liat@skitza.app",
    invitedAt: null,
    clerkUserId: null,
    tags: ["folk", "live"],
    referralSource: null,
    lastSeenAt: daysAgo(45),
    position: 5,
  },
];

const insertedContacts = [];
for (const c of CLIENTS) {
  const [row] = await sql`
    INSERT INTO client_contacts (
      producer_id, email_hash, email, name, first_seen_at, last_seen_at,
      tags, referral_source, invited_at, clerk_user_id, position
    ) VALUES (
      ${producer.id},
      ${emailHashFor(c.email)},
      ${c.email}, ${c.name},
      ${daysAgo(60).toISOString()}, ${c.lastSeenAt.toISOString()},
      ${c.tags}, ${c.referralSource},
      ${c.invitedAt ? c.invitedAt.toISOString() : null},
      ${c.clerkUserId},
      ${c.position}
    )
    ON CONFLICT (producer_id, email_hash) DO UPDATE SET
      name = EXCLUDED.name,
      invited_at = EXCLUDED.invited_at,
      clerk_user_id = EXCLUDED.clerk_user_id,
      tags = EXCLUDED.tags,
      referral_source = EXCLUDED.referral_source,
      last_seen_at = EXCLUDED.last_seen_at,
      position = EXCLUDED.position
    RETURNING id, name, email
  `;
  insertedContacts.push(row);
  console.log(`  client: ${row.name}`);
}

// ─── Mock projects ────────────────────────────────────────────────
// Each project ties to one of the contacts above via clientName +
// clientEmail (snapshot fields). For outstanding-balance math the
// procedure joins through bookings.product_id → products.price_cents,
// so we also insert a booking per project pointing at the producer's
// first product.
//
// Stage distribution: lead, booked, booked, in_production, in_production,
// in_production, final_review, paid, paid, archived.

const PROJECTS = [
  { title: "DEMO Sunrise EP", clientIdx: 0, stage: "in_production", depositPaid: true, finalPaid: false, daysAhead: 3,  workflowStage: "mixing",     position: 0 },
  { title: "DEMO Daydream",   clientIdx: 1, stage: "final_review",  depositPaid: true, finalPaid: false, daysAhead: 1,  workflowStage: "mastering",  position: 1 },
  { title: "DEMO Midnight Run", clientIdx: 0, stage: "paid",        depositPaid: true, finalPaid: true,  daysAhead: -10,workflowStage: "done",       position: 2 },
  { title: "DEMO First Light",  clientIdx: 2, stage: "booked",      depositPaid: true, finalPaid: false, daysAhead: 6,  workflowStage: "production", position: 3 },
  { title: "DEMO Quiet Hour",   clientIdx: 3, stage: "lead",        depositPaid: false,finalPaid: false, daysAhead: null,workflowStage: "brief",     position: 4 },
  { title: "DEMO Brass City",   clientIdx: 1, stage: "in_production",depositPaid: true, finalPaid: false,daysAhead: 9,  workflowStage: "mixing",     position: 5 },
  { title: "DEMO Smoke & Stone",clientIdx: 4, stage: "in_production",depositPaid: false,finalPaid: false,daysAhead: -2, workflowStage: "production", position: 6 },
  { title: "DEMO Velvet Hours", clientIdx: 5, stage: "archived",    depositPaid: true, finalPaid: true,  daysAhead: -60,workflowStage: "done",       position: 7 },
  { title: "DEMO Anchor",       clientIdx: 2, stage: "booked",      depositPaid: true, finalPaid: false, daysAhead: 14, workflowStage: "brief",      position: 8 },
  { title: "DEMO Patchwork",    clientIdx: 0, stage: "paid",        depositPaid: true, finalPaid: true,  daysAhead: -30,workflowStage: "done",       position: 9 },
];

let projectsInserted = 0;
let projectsSkipped = 0;
for (const p of PROJECTS) {
  const contact = insertedContacts[p.clientIdx];
  if (!contact) continue;

  // Skip if the producer already has a project with this exact title
  // (so re-running the seed is idempotent without producing duplicates).
  const existing = await sql`
    SELECT id FROM projects
    WHERE producer_id = ${producer.id} AND title = ${p.title}
    LIMIT 1
  `;
  if (existing.length > 0) {
    projectsSkipped++;
    continue;
  }

  // Insert the project. clientName + clientEmail are the snapshot fields
  // the list view joins on; artistName + artistEmail are legacy required
  // columns we mirror with the same data for v1.
  const [project] = await sql`
    INSERT INTO projects (
      producer_id, title, stage, workflow_stage,
      client_name, client_email,
      artist_name, artist_email,
      deposit_paid, final_paid,
      total_amount_cents, currency,
      position,
      created_at, updated_at
    ) VALUES (
      ${producer.id}, ${p.title}, ${p.stage}, ${p.workflowStage},
      ${contact.name}, ${contact.email},
      ${contact.name}, ${contact.email},
      ${p.depositPaid}, ${p.finalPaid},
      ${product.price_cents}, ${product.currency},
      ${p.position},
      ${daysAgo(30).toISOString()}, ${daysAgo(1).toISOString()}
    )
    RETURNING id, title
  `;

  // Insert a confirmed booking so the project gets a session date +
  // joins to product.price_cents for outstanding math.
  const startsAt =
    p.daysAhead != null
      ? new Date(NOW.getTime() + p.daysAhead * 24 * 60 * 60 * 1000)
      : null;

  if (startsAt) {
    await sql`
      INSERT INTO bookings (
        producer_id, project_id, product_id,
        status,
        starts_at, duration_min,
        package_name_snapshot,
        artist_name, artist_email,
        created_at
      ) VALUES (
        ${producer.id}, ${project.id}, ${product.id},
        'confirmed',
        ${startsAt.toISOString()}, 60,
        ${product.name},
        ${contact.name}, ${contact.email},
        ${daysAgo(20).toISOString()}
      )
    `;
  }

  projectsInserted++;
  console.log(`  project: ${project.title}`);
}

console.log("");
console.log(
  `Done. Contacts seeded: ${insertedContacts.length}. Projects inserted: ${projectsInserted} (skipped existing: ${projectsSkipped}).`,
);
console.log("");
console.log("To remove the demo data later:");
console.log("  DATABASE_URL=... node scripts/seed-clients-projects-demo.mjs --cleanup");
