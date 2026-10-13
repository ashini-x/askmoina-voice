# RC3 — Visible response-card tray

Status: Implementation candidate; must pass release validation and authenticated live synthetic verification before being considered shipped.

## Scope

- Render the bounded RC2 response-card payload in a compact, accessible tray on the Co-Pilot camera screen.
- Replace an earlier card when a new card arrives; support collapse/expand and dismiss.
- Keep the camera view and primary call controls available. Position the tray above the captions/controls and keep it compact and scrollable on small screens.
- Render a generic structured-data view in RC3. Rich type-specific card layouts and interaction refinements remain RC4.
- Create DOM nodes and write model-supplied values through text APIs only; never interpret model content as HTML, CSS, or script.
- Re-check the server's size, field, and text bounds before rendering. If client validation fails, do not display the card and do not tell the model it was displayed.
- A visible card is reference content only. Do not mark any step complete just because it was rendered.
- Preserve a spoken response alongside the card and never route response-card payloads through the camera-overlay system.

## Acceptance checks

- Asset parity: Worker-embedded HTML, CSS, and JavaScript match the checked-in public assets.
- Static checks cover the tray's semantic labels, collapse/dismiss controls, safe text rendering, bounded client validation, and reduced-transparency styling.
- Automated release validation passes.
- Production live synthetic run confirms:
  - live grounding still invokes its tool and completes a grounded answer;
  - the Live Co-Pilot calls display_response_card for an explicit card request;
  - the payload is valid, the browser-side tray renderer accepts it, the tool acknowledgement is sent, and a post-tool answer completes;
  - the separate audio/memory test still succeeds;
  - the temporary synthetic identity is revoked.
- Passing the synthetic run confirms protocol and UI contract checks; it does not replace human review of the visual design across phone/desktop sizes or prove the visible card is suitable for every task.
