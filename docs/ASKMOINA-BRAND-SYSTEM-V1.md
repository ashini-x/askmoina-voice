# AskMoina Signature & Orb System — v1

## Core idea
A custom, swept-wing bird mark represents a helpful presence and forward motion. The same mark is used everywhere; the interface never switches to a phone handset to invite interaction. Visual restraint comes first: monochrome by default, with a small, controlled light response only while AskMoina is connecting, listening, or speaking.

`public/askmoina-mark.svg` is the single source of truth for the bird silhouette. Every variant must reuse its exact path geometry; changing theme, canvas, scale, or placement is allowed, but redrawing, tracing, stretching, or reshaping the mark is not. Raster exports must be rendered from that same approved path.

- `public/askmoina-mark.svg`: white master symbol for dark surfaces.
- `public/askmoina-mark-dark.svg`: the exact same geometry in dark ink for light surfaces.
- `public/askmoina-logo.svg` / `public/askmoina-logo-dark.svg`: horizontal wordmarks with the same symbol and “SEE · UNDERSTAND · HELP”.
- `public/askmoina-app-icon.svg` and `public/askmoina-app-icon-light.svg`: dark and light app icons.
- `public/pwa-icon-192.svg`, `public/pwa-icon-512.svg`, `public/askmoina-app-icon-180.png`, and `public/askmoina-bird-final.png`: install/Home Screen icon assets.
- `public/askmoina-bird-mark.png` and `public/askmoina-bird-64.png`: small raster mark exports.
- `public/askmoina-social-avatar.svg`: social profile avatar artwork.
- `public/askmoina-visual-guide.svg`: the same approved bird inside the separate open-orbit visual-guidance treatment.

## Palette
- Deep ink: `#08090c`
- Porcelain: `#f8f8fa`
- Light surface: `#f5f5f7`
- Ink on light surfaces: `#171719`
- Active-only light: cool silver with restrained periwinkle/lilac in the edge highlight.

Do not use a permanent neon rainbow, green call colour, or red call badge as part of the primary identity. Do not approximate another company's icon.

## Orb placement and behaviour
The orb is the existing primary start/stop control in the bottom-centre control row of the camera experience. This keeps it where a primary action belongs, avoids adding a second floating control, and preserves the camera's sightline. The separate welcome orb sits above the “Slide to start” action while idle.

- **Idle:** crisp bird symbol, fine silver outline, no continuous attention-grabbing animation.
- **Connecting:** rotating edge glint and a restrained breathing halo.
- **Listening:** soft edge movement follows the real microphone energy signal.
- **Responding:** the ring brightens and gently expands while assistant audio is actually playing.
- **Ready / silent active session:** slow, low-amplitude breathing only.
- **Reduced motion:** animations are removed; state and contrast remain visible.

The control continues to start and stop the session with the same underlying event handlers. The orb is a state indicator, not a claim that a provider is connected when it is not.

## Implementation notes
CSS state selectors use the camera stage’s real `is-connecting`, `is-listening`, `is-speaking`, and `voice-active` classes. `data-orb-state` is kept in sync with those state changes for observability and UI tests. `src/copilot-assets.ts` is generated from the checked-in HTML, JS, and CSS so the embedded Worker assets stay identical.
