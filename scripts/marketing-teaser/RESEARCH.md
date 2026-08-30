# What makes a product teaser convert — research → decisions

Findings from published guidance on SaaS demo/teaser videos, short-form hooks,
and motion design, each mapped to a concrete decision in this film (v3).

## Findings

1. **The first 3 seconds decide everything.** ~87% of viewers decide to stay
   or skip within 3s; Meta data: 65% of people who watch the first 3s watch
   at least 10s. Opening with a warm-up (logo, intro) is the canonical
   mistake — lead with the pain or the payoff, explain after.
   *(teleprompter.com, coinis.com, scenith.in, torro.io)*
2. **Open on a pain the viewer already feels.** The strongest demos start
   with problem recognition — the viewer must see their own frustration
   before they care about the solution. *(bluecarrot.io, levitatemedia.com)*
3. **Story, not feature tour.** Hook → problem → solution → proof → CTA.
   A sequence of screens with no narrative thread is the most common failure
   mode ("laundry list"). Frame each beat as a benefit, not a feature.
   *(motionvillee.com, whatastory.agency, contentbeta.com)*
4. **Raw full screenshots read as lazy and are illegible.** Viewers judge
   production quality subconsciously; zoom into the one region that proves
   the claim, with deliberate motion. *(contentbeta.com, autozoom.app)*
5. **Design for silent autoplay.** Most feed views are muted: oversized
   kinetic text must carry the message; the strongest examples (e.g. Notion's
   promos) make type the physical hero that pushes UI around the frame.
   *(designrush.com, svgator.com, advids.co)*
6. **Cut to the audio rhythm.** Syncing motion and cuts to the beat measurably
   lifts engagement; pop/zoom/snap entrances for social. *(advids.co, todaymade.com)*
7. **Production coherence = trust.** Clean minimal visuals with good sound
   inspire trust; incoherent data (mixed names, mismatched amounts) reads as
   fake. *(bluecarrot.io, thedesirecompany.com)*
8. **Always end with an explicit CTA.** Brand reveal and ask belong at the
   end, once the value is proven. *(levitatemedia.com, pepsales.ai)*

## Decisions taken for v3

| # | Finding | v3 decision |
|---|---|---|
| 1 | 3-second rule | Cold open is the producer's pain (DM chaos), not a logo. Wordmark moved to the END. |
| 2 | Pain first | Hook: generic chat bubbles piling up — "did my transfer arrive??", "which mix is final?" — with a rising badge count. |
| 3 | Story arc | Hook → turn ("one link runs the whole studio") → 4 benefit beats → payoff (paid in full) → CTA. Approval beat cut: no current-component screen exists for it, and 4 proof beats beat 6. |
| 4 | No raw screenshots | Every product shot is a measured element-region crop (rects recorded from the live DOM), shown complete — no blind cropping, nothing clipped. |
| 5 | Silent-safe | Oversized Syne headlines carry the story; UI is evidence beneath them. |
| 6 | Rhythm | All cuts on a 100 BPM grid (0.6s), documented so the music bed can lock to it. |
| 7 | Coherence | One story world enforced at capture: Northline Studio, Maya Cohen, "Midnight Drive", ₪2,400 deal / ₪1,200 deposit. Only current-component gallery keys; stale `~/components/dev/*` mocks excluded. |
| 8 | CTA | End card: "Stop chasing. Start producing." → wordmark → skitza.app. |

## Screen source policy

Dev-gallery keys are used **only** when they render live product components
(`WorkspaceListView`, `ReviewAgreeScreen`, `PaymentProofReview`,
`PaymentSummaryScreen`, `SongSpace`, artist-store components). Keys that
render `~/components/dev/*` snapshots (`sk8-*`, `sk94-*`, `sk72-*`,
`sk75-*`, `sk69-*`) drift from the product and are excluded.
