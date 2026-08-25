import { describe, expect, it } from "vitest";

import config from "../../../next.config";

// SK-277 regression. The admin console opens interactive Neon sessions (the
// per-email advisory lock used by Producer invitations and beta wave
// releases) over the Node `ws` package. When Next bundles `ws`, Webpack
// stubs out its optional `bufferutil` dependency; `ws` then calls a missing
// `.mask()` and the serverless process is killed mid-request, which reaches
// the founder as "Sent 0 of N — N failed" with no explanation. Both opt-outs
// below are what keep that from coming back.

describe("admin next config ws opt-out", () => {
  it("keeps `ws` out of the server bundle", () => {
    expect(config.serverExternalPackages).toContain("ws");
  });

  it("compiles in the official bufferutil opt-out for bundles Next still inlines", () => {
    expect(config.env?.WS_NO_BUFFER_UTIL).toBe("1");
  });
});
