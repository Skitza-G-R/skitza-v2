import { clientContacts, desc, eq } from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";

// Producer-scoped read surface for the client contacts cache. Feeds
// the autocomplete dropdown on send-forms (new deal, contract send)
// so returning artists' info pre-fills. Filtering is done in JS so
// the caller can fetch-once on mount and narrow as the user types
// without round-tripping per keystroke.
export const clientContactsRouter = router({
  list: producerProcedure
    .input(z.object({ q: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: clientContacts.id,
          email: clientContacts.email,
          name: clientContacts.name,
          lastSeenAt: clientContacts.lastSeenAt,
        })
        .from(clientContacts)
        .where(eq(clientContacts.producerId, ctx.producerId))
        .orderBy(desc(clientContacts.lastSeenAt));

      const q = input?.q?.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      );
    }),
});
