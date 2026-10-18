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

## Typography — canonical global font

The canonical UI typography name is **`askmoina-global-font`**. Its implementation is `public/askmoina-global-font.css`, backed by the self-hosted Comfortaa Light WOFF2 subset at `public/askmoina-global-font.woff2`. Its thin, rounded geometric forms and single-storey lowercase “a” are chosen to match the approved AskMoina wordmark reference consistently across devices, without a remote font request.

All visible UI text must inherit this one family: headings, body copy, navigation, buttons, form controls, dialogs, overlays, captions, response cards, and dynamically rendered content. Do not introduce another font family for ordinary interface text. Component-specific size, weight, line-height, spacing, and typographic hierarchy can still vary. The `askmoina` wordmark uses tight tracking and a subtle progression in stroke weight from the `o` through the final `a`; HTML-rendered wordmarks should use `.askmoina-wordmark` with one inline span per letter, and SVG logos should use vector outlines.

Future UI work must preload `/askmoina-global-font.woff2?v=0.4.132` near the start of the HTML `<head>`, then load `/askmoina-global-font.css` after component stylesheets. The font uses `font-display: block` to prevent a visible fallback-font flash while the preloaded face becomes available. Worker-generated shells inject the preload automatically; standalone new HTML pages must include it explicitly. The repository contract test verifies the token, preload order, and key page entry points.

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
