# Fresh-chat prompt — restore artist payment proof

Copy everything inside the block below into the new chat.

```text
Please implement the artist payment-proof restoration documented here:

/Users/giliasraf/Skitza 16.4/docs/plans/active/2026-08-03-artist-payment-proof-flow-restoration.md

Read AGENTS.md and the complete plan before changing anything. Use easy English
with me.

Important product decision from Gili: an artist must be able to upload payment
proof even when the producer has not saved Bank or Bit details. Show the honest
fallback that the producer will send those details directly. Restore the useful
old payment-instructions and photo-upload design from commit 4eb84d34, but keep
the current secure backend, canonical /artist/payments routes, server-locked
installment amount, private R2 upload, idempotency, proof history, and route
guards. Do not revert the full old commit.

Also fix Send proof so a synchronous upload-start error is shown instead of
looking stuck. On an accepted producer Request, show a clear Review payment
proof action for a pending proof and link it to the exact existing
/dashboard/payments/[proofId] review page. Confirm/reject must remain in
Payments; do not move that form back into Requests.

Follow the repository workflow exactly:

1. Inspect the latest current code from v3-clean.
2. Find and read the full Linear issue for this fix, or create the required
   issue in Skitza v3 / team SK if none exists. Move it to In Progress.
3. Use Linear's exact generated branch name from the latest v3-clean.
4. Work in a separate worktree. The shared root is on an unrelated dirty SK-82
   branch with user-owned changes, including overlapping payment files. Do not
   stage, discard, overwrite, or mix those changes.
5. Reproduce the missing-method gate and the upload-start failure before the
   fix when practical.
6. Implement only the documented scope and add focused regression tests.
7. Run the real artist upload -> producer review -> artist verified flow. The
   mocked dev proof screen alone is not enough.
8. Visually verify desktop, true 390px, and true 360px.
9. Run $skitza-verify before claiming completion. Report exact failures; do not
   hide baseline problems.
10. Do not merge, migrate production, deploy, or promote without my separate
    approval.

Useful history:

- old visual design: 4eb84d34
- producer proof review moved to Payments: 2eaaa758
- artist UI replacement that added the Bank/Bit gate: 2d2b3752
- v3-clean inspected during diagnosis: 648ca62498d9c24fe1441b6b7a1ed5c5711ae64e

Start by telling me the Linear issue, branch/worktree, and the exact behavior
you reproduced. Then continue through implementation and verification without
stopping for non-blocking questions.
```
