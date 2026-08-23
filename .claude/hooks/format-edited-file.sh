#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): format ONLY the file Claude just touched.
#
# Claude Code passes the tool call as JSON on stdin; the file path lives at
# tool_input.file_path. The old hook used $CLAUDE_TOOL_FILE_PATH, which is
# empty in current Claude Code, and `prettier --write ""` formats the WHOLE
# repository (every worktree included). Guard hard: no path → do nothing.
set -u

input="$(cat 2>/dev/null || true)"
file="$(printf '%s' "$input" | node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(data);
    const path = parsed?.tool_input?.file_path ?? "";
    process.stdout.write(typeof path === "string" ? path : "");
  } catch {
    process.stdout.write("");
  }
});
' 2>/dev/null || true)"

# Fall back to the legacy variable only when it is non-empty.
if [ -z "$file" ] && [ -n "${CLAUDE_TOOL_FILE_PATH:-}" ]; then
  file="$CLAUDE_TOOL_FILE_PATH"
fi

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.md|*.mdx|*.yml|*.yaml) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" && pnpm exec prettier --write "$file" >/dev/null 2>&1 || true
exit 0
