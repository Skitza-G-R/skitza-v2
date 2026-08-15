import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RuntimeStateDisabledProvider, useRuntimeState } from "../runtime-state-provider";

function RuntimeStateProbe() {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();

  return (
    <output
      data-user={identity.userId}
      data-private-state={String(privateStateAccessAllowed)}
      data-storage={storage === null ? "none" : "available"}
    />
  );
}

describe("RuntimeStateDisabledProvider", () => {
  it("satisfies shared hooks without exposing private state or storage", () => {
    const html = renderToStaticMarkup(
      <RuntimeStateDisabledProvider>
        <RuntimeStateProbe />
      </RuntimeStateDisabledProvider>,
    );

    expect(html).toContain('data-user="signed-out"');
    expect(html).toContain('data-private-state="false"');
    expect(html).toContain('data-storage="none"');
  });
});
