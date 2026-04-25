# Story 08 — Step 4: Portfolio page (composes 06 + 07)

> Skitza-BMAD · Story 08 of 10
> Architecture: §4.5, §5
> **Depends on:** Stories 06 (links editor) + 07 (uploader card)

---

## As a producer at Step 4 of onboarding...

I want a single page where I can drop in my links AND upload tracks before finishing onboarding.

## Acceptance criteria

- [ ] `/onboarding/portfolio` renders shell (currentStep=4, title "Show your work.").
- [ ] Renders `<ExternalLinksEditor>` (Story 06) and `<PortfolioUploaderCard>` (Story 07), stacked vertically. Order: links above tracks (faster to fill).
- [ ] Helper copy at the top: "Add at least one — links or a track. You can add more from Setup later."
- [ ] Continue → calls `saveExternalLinks` (if any links typed) AND `await`s any in-flight uploads, then `router.push("/dashboard")`.
- [ ] Skip for now → routes to `/dashboard` immediately, NO save (any partial tracks already uploaded stay; any half-typed links are discarded).
- [ ] If `<PortfolioUploaderCard>` reports `isUploading`, Continue is disabled (Skip is always available).
- [ ] Telemetry: step_completed (with link count + track count meta) on Continue, step_skipped on Skip.
- [ ] Step-aware decide-redirect (Story 04) covers this route too.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/portfolio/page.tsx`
- `apps/web/src/app/(onboarding)/onboarding/portfolio/__tests__/page.test.tsx`

**Modify:** none (pure composition).

### Page implementation outline

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "../shell";
import { ExternalLinksEditor } from "~/components/onboarding/external-links-editor";
import { PortfolioUploaderCard } from "~/components/onboarding/portfolio-uploader-card";
import { saveExternalLinks } from "./links-actions";

export default function Step4Page() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const [links, setLinks] = useState<{platform; url}[]>([]);

  function handleContinue() {
    startTransition(async () => {
      if (links.some((l) => l.url)) await saveExternalLinks({ links });
      router.push("/dashboard");
    });
  }

  function handleSkip() {
    router.push("/dashboard");
  }

  return (
    <OnboardingShell currentStep={4} title="Show your work."
      onBack={...} onSkip={handleSkip}
      onContinue={handleContinue}
      continueDisabled={pending || isUploading}
    >
      <ExternalLinksEditor onChange={setLinks} />
      <PortfolioUploaderCard onUploadingChange={setIsUploading} />
    </OnboardingShell>
  );
}
```

### Conventions

- CSS vars only
- 44px tap targets
- Order matters: links first (lower friction) → upload (higher friction)

## TDD steps

Smoke-only test: page renders both subcomponents; mock both children; click Continue → assert save + push fired; click Skip → assert push fired without save.

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): step 4 — portfolio page composes links + uploader

Wizard's Step 4 stitches together <ExternalLinksEditor /> (Story 06)
and <PortfolioUploaderCard /> (Story 07) in a single full-screen step.
Continue persists any typed links + waits for in-flight uploads, then
routes to /dashboard. Skip routes to /dashboard immediately (any
already-uploaded tracks stay; partial links discarded).

Continue button is disabled while uploads are in flight (reads
isUploading callback from the card). Skip is always available.

Final step in the 4-step rebuild — completing it (or skipping it)
ends the onboarding flow and lands the producer on Today.

Story 08 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] Both subcomponents render
- [ ] Continue waits for uploads
- [ ] Skip never blocks
- [ ] Helper copy reads as specified

### Code quality

- [ ] No state leakage between mount/unmount
- [ ] State management is local (useState) — no Zustand / Redux for this scope
