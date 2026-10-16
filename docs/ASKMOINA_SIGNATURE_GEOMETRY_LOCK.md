# AskMoina Signature Geometry — Locked v1.0

**Status: LOCKED.** This is the approved master geometry for the AskMoina signature mark, accepted on 17 October 2026.

## Canonical source

- Canonical asset: `public/askmoina-mark.svg`
- ViewBox: `0 0 163 115`
- The SVG path geometry is pinned by a SHA-256 regression assertion in `test/copilot-assets.test.js`.
- Approved raster export: `AskMoina-Signature-Locked-v1.0.png` (2048 × 1444, transparent background).

## Rules for future changes

1. Do not redraw, simplify, round, sharpen, stretch, skew, or otherwise alter the SVG path, proportions, or viewBox during unrelated UI work.
2. The visible orb mark and processing-wave mask must use this canonical asset; do not create separate approximations of the signature.
3. A geometry change requires an explicit request from the product owner to unlock the signature. After approval, create a new named lock version and update the reference PNG and regression fingerprint in the same change.
4. If the geometry fingerprint test fails, treat it as an intentional brand-asset change requiring review—not as a test to weaken or remove.
5. Colour, lighting, glow, ring animation, and placement may evolve independently as long as they do not change the locked silhouette.

## Version naming

Use the name **AskMoina Signature Geometry — Locked v1.0** when referring to this approved shape. Keep the canonical SVG as the source of truth; PNGs are exports, not alternate geometry masters.
