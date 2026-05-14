import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// F8 — per-comment producer reply on the project room Music sub-tab.
//
// Following the repo convention (see ../../today/__tests__/
// recent-uploads-shelf.test.tsx): vitest runs in node env, so we pin
// the rendering decisions via source-grep rather than mounting React.
//
// What this test guards:
//   1. A "Reply" button is rendered alongside Resolve / Re-open on
//      every comment row.
//   2. An inline reply form (textarea + Send + Cancel) toggles per
//      row.
//   3. Open-state is a single `string | null` (the open comment id) —
//      NOT a Record<string, boolean>. Per brief: only one reply form
//      open at a time keeps the UX cleaner and avoids stale-state bugs.
//   4. Send calls `addProducerComment` with the original comment's
//      `timestampMs` so the reply pins at the same moment in the
//      track. Threading is visual via timestamp proximity — the
//      `track_comments` table has no `parentCommentId` column and the
//      brief explicitly forbids adding one.
//   5. The pre-existing bottom <ProducerReplyForm> (free-form
//      timestamped note path) is preserved — both UX paths coexist.
//   6. The pre-existing Resolve / Re-open flow is untouched.

const here = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(here, "..", "music-sub-tab.tsx");
const src = readFileSync(SRC_PATH, "utf8");

describe("music-sub-tab F8 — per-comment producer reply", () => {
  it("introduces replyOpenFor state to track which comment's reply form is open", () => {
    expect(src).toContain("replyOpenFor");
    expect(src).toContain("setReplyOpenFor");
  });

  it("types reply-open state as `string | null` (the open comment id)", () => {
    // Per brief: the canonical pattern is
    //   const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null);
    // The regex is anchored to `replyOpenFor` because an unrelated
    // `versionFor` state already uses `useState<string | null>(null)`
    // — without the anchor this is a false positive.
    expect(src).toMatch(
      /\[replyOpenFor,\s*setReplyOpenFor\]\s*=\s*useState<string \| null>\(null\)/,
    );
  });

  it("does NOT use a Record<id, boolean> for reply-open state (single-open rule)", () => {
    expect(src).not.toMatch(/Record<string,\s*boolean>/);
  });

  it("renders a 'Reply' button for comment rows", () => {
    // The label "Reply" doesn't otherwise appear as a JSX child in
    // this file (placeholders use it as an attribute value, function
    // names use ProducerReplyForm) so a >Reply< match is decisive.
    expect(src).toMatch(/>\s*Reply\s*</);
  });

  it("Send submits with the original comment's own timestampMs (not a manual input)", () => {
    // Replies pin to the same moment as the parent so the comment
    // list (sorted by timestamp) places them adjacent. The bottom
    // ProducerReplyForm uses `Math.round(secs * 1000)` from a manual
    // seconds input — that's a different path. The per-comment Reply
    // must use the comment's `c.timestampMs` verbatim.
    expect(src).toMatch(/timestampMs:\s*c\.timestampMs/);
  });

  it("the per-comment reply path calls addProducerComment", () => {
    expect(src).toContain("addProducerComment");
  });

  it("preserves the pre-existing bottom <ProducerReplyForm> (free-form note path)", () => {
    // Brief: "Don't remove the existing bottom ProducerReplyForm —
    // keep both UX paths." Pin the JSX usage AND the function
    // definition.
    expect(src).toContain("<ProducerReplyForm");
    expect(src).toContain("function ProducerReplyForm(");
  });

  it("preserves the existing Resolve / Re-open flow untouched", () => {
    expect(src).toMatch(/>\s*Resolve\s*</);
    expect(src).toMatch(/>\s*Re-open\s*</);
    expect(src).toContain("resolveVersionComment");
  });

  it("does not reference a parentCommentId column (schema has none — do not add one)", () => {
    // Brief: "The `track_comments` table has no `parentCommentId`
    // column. Do not add one." We pin the negative on real code only,
    // stripping comments first — narrative comments may legitimately
    // mention parentCommentId while explaining *why* we don't have it.
    // Mirrors the comment-strip pattern in recent-uploads-shelf.test.tsx
    // (the `right-1` RTL guard).
    const codeOnly = src
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toContain("parentCommentId");
    expect(codeOnly).not.toContain("parent_comment_id");
  });

  it("router.refresh() is reachable so the new reply renders after Send", () => {
    // Reply success must mirror the existing onResolve handler:
    // toast + router.refresh() so the new comment appears in the
    // list. Sanity check that the call site didn't get removed
    // during the change.
    expect(src).toContain("router.refresh()");
  });
});
