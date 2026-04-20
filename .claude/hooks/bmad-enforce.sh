#!/usr/bin/env bash
# BMAD enforcement hook — runs on every UserPromptSubmit.
# Injects a reminder into the Claude context so BMAD is never forgotten.
# User is a non-technical solo founder — this is the safety net.
#
# The hook outputs text to stdout which Claude Code injects as additional
# context for the turn. Does NOT block or modify the user's prompt.

cat <<'EOF'
<bmad-enforcement>
⚠ BMAD ENFORCEMENT ACTIVE

Before responding to the user's request, evaluate:

1. Is this a product-change request? (feature, bug, UI tweak, copy edit, refactor, follow-up on previous work)
   → YES: you MUST invoke the `bmad` skill and follow its FIRST-RESPONSE PATTERN.

2. Is this purely informational? (explain X, show me Y, what does Z do)
   → OK to answer directly without BMAD.

3. Did the user explicitly say "skip BMAD" or equivalent?
   → OK to skip, but note the risk.

If #1 applies and you have NOT yet invoked BMAD this turn, STOP and invoke it BEFORE:
- Writing any code
- Dispatching any subagent
- Editing any file under apps/web/, packages/db/, or docs/
- Answering a design/spec question that will shape implementation

The BMAD first-response pattern is:
    🔧 Running BMAD · <Quick|Standard|Large> track · Phase 1: Analyst
    <3 plain-English questions for the user>

User is NON-TECHNICAL. Translate all technical questions to plain English.
Never ask about tRPC procedures, schema, auth scope, or implementation details.
</bmad-enforcement>
EOF
