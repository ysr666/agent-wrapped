# Design QA — Agent Wrapped prototype

## Scope

- Viewport: 1440 × 1024, device scale factor 1
- Floating-card target: `/Users/ysradmin/.codex/generated_images/01a01e2e-721e-7473-bea2-4b3dba9c04f9/exec-5d7c3e60-568f-4f4d-a990-925a413969e5.png`
- Share target: `/Users/ysradmin/.codex/generated_images/01a01e2e-721e-7473-bea2-4b3dba9c04f9/exec-307ee061-924d-46e2-9403-0a5a0fa8a707.png`
- Implementation captures: `qa/workspace-floating-card.png`, `qa/full-wrapped.png`, `qa/share-poster.png`
- Side-by-side comparisons: `qa/compare-floating.png`, `qa/compare-share.png`

## Visual comparison

- Floating surface preserves the selected target's native dark workspace, bottom-right placement, restrained chrome, one dominant result, direct CTA, dismiss control, and truth provenance. It is intentionally lighter than the original share-oriented treatment, following the later product decision.
- Complete view clearly reveals three selected conclusions while keeping the strongest item first and the supporting evidence visible beside them.
- Share view preserves the target's off-white newsprint, red masthead, oversized condensed headline, yellow category/commentary strips, black rules, blue user quote, red annotations, handwritten-style marginalia, and 4:5 poster composition.
- Typography remains readable at the tested viewport. No clipping, overflow, or overlapping controls were observed.

## Interaction verification

- `看看本场大赏` opens the complete result.
- Complete result contains three award cards and grounded evidence.
- Share action shows the generation state and then the newspaper poster.
- `保存分享图` completes and shows `PNG 已保存`.
- Returning to the result and session works.
- Switching between all four golden sessions updates the floating result.
- Dismiss and reopen behavior works.
- Browser console: no errors or warnings.

## Automated checks

- `npm run build`: passed
- `npm run test:sites`: 4/4 passed

final result: passed
