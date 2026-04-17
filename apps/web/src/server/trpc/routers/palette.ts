import {
  and,
  clientContacts,
  contracts,
  deals,
  desc,
  eq,
  ilike,
  or,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// ⌘K command palette search. Unions three producer-scoped streams
// (deals, client contacts, contracts) behind one procedure so the
// client can render grouped results without fanning out to three
// queries. Kept flat + deliberately simple — no full-text index yet,
// just ilike on 1–5 columns per table with a per-type cap of 10.
//
// Empty query is a "recents" surface (last 5 per type by updatedAt /
// lastSeenAt) so ⌘K is useful the moment it opens.
export const paletteRouter = router({
  search: producerProcedure
    .input(z.object({ q: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      const raw = input.q.trim();

      if (raw.length === 0) {
        const [recentDeals, recentContacts, recentContracts] = await Promise.all([
          ctx.db
            .select()
            .from(deals)
            .where(eq(deals.producerId, ctx.producerId))
            .orderBy(desc(deals.updatedAt))
            .limit(5),
          ctx.db
            .select()
            .from(clientContacts)
            .where(eq(clientContacts.producerId, ctx.producerId))
            .orderBy(desc(clientContacts.lastSeenAt))
            .limit(5),
          ctx.db
            .select()
            .from(contracts)
            .where(eq(contracts.producerId, ctx.producerId))
            .orderBy(desc(contracts.createdAt))
            .limit(5),
        ]);
        return {
          deals: recentDeals.map((d) => ({ id: d.id, title: d.title, stage: d.stage })),
          contacts: recentContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
          contracts: recentContracts.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        };
      }

      // Fuzzy ilike across identity fields. Deals get both the new
      // clientName/clientEmail and the legacy artistName/artistEmail
      // columns since C.1 kept them (C.2 will consolidate). Cap at 10
      // per type so the palette list stays navigable from the keyboard.
      const pattern = `%${raw}%`;
      const [matchDeals, matchContacts, matchContracts] = await Promise.all([
        ctx.db
          .select()
          .from(deals)
          .where(
            and(
              eq(deals.producerId, ctx.producerId),
              or(
                ilike(deals.title, pattern),
                ilike(deals.clientName, pattern),
                ilike(deals.clientEmail, pattern),
                ilike(deals.artistName, pattern),
                ilike(deals.artistEmail, pattern),
              ),
            ),
          )
          .orderBy(desc(deals.updatedAt))
          .limit(10),
        ctx.db
          .select()
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.producerId, ctx.producerId),
              or(
                ilike(clientContacts.name, pattern),
                ilike(clientContacts.email, pattern),
              ),
            ),
          )
          .orderBy(desc(clientContacts.lastSeenAt))
          .limit(10),
        ctx.db
          .select()
          .from(contracts)
          .where(
            and(
              eq(contracts.producerId, ctx.producerId),
              // PDF contracts (post-B.2) scope artist identity per
              // recipient in contract_recipients — title is the only
              // searchable field on the contracts row itself.
              ilike(contracts.title, pattern),
            ),
          )
          .orderBy(desc(contracts.createdAt))
          .limit(10),
      ]);
      return {
        deals: matchDeals.map((d) => ({ id: d.id, title: d.title, stage: d.stage })),
        contacts: matchContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
        contracts: matchContracts.map((c) => ({ id: c.id, title: c.title, status: c.status })),
      };
    }),
});
