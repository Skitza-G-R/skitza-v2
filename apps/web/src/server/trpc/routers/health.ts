import { APP_VERSION } from "~/lib/version";
import { publicProcedure, router } from "../init";

export const healthRouter = router({
  check: publicProcedure.query(() => ({
    ok: true as const,
    version: APP_VERSION,
  })),
});
