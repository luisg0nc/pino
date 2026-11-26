---
paths:
  - "app/src/renderer/styles/**"
  - "app/src/shared/contrast.ts"
  - "app/src/shared/contrast.test.ts"
  - "app/src/shared/fonts.ts"
  - "app/src/shared/fonts.test.ts"
---

# Stylesheets, tokens, light and dark

## About the folder (`app/src/renderer`)

The UI (`ui/`), the store (`state/`) and the stylesheets (`styles/`: `tokens.css`, and `app.css`, which is nothing but
the list of the stylesheets by area in the order of the cascade; `styles.test.ts` holds it to that). The look is
torno's: the surface plate, warm paper grey and graphite, hairlines, one shadow, one easing, motion only where
something changed. A sheet copied from torno keeps its rules; pino's own areas have sheets of their own
(`route.css`, `views.css`).

## Light and dark

- The tokens (`tokens.css`) are held to their contrasts by `shared/contrast.test.ts`, which reads the file: whatever is
  read as text is 4.5:1 on the ground it stands on (`--ink` 7:1; `--muted`, `--accent`, `--ok`, `--warn`, `--fail` on
  `--surface` and `--panel`; the accent on its wash); what is only drawn is 3:1 (the two mark colours on the surface);
  a hairline is between 1.15 and 2; the edge of an input or a text area is `--field-edge`, 3:1 on both. A token is
  changed there first.
- **The accent is solder-mask green**, where torno's is layout blue: `#17663A` in light, `#5CC489` in dark. The dyed
  field (`--dye`, `--scribe`, `--on-dye`, `--on-dye-muted`) is solder mask over a bare board: the first screen and the
  empty views, never a screen with a board on it. `--dye` equals `--accent` in light.
- **Marks:** `--agent-mark` is Claude Code's orange (`#D97757` in dark; `#C0502B` in light, darkened to the first
  shade that passes). `--user-mark` is the violet of the design mocks: `#6440C4` in light, `#A88BFA` in dark. A verdict
  (`--ok`, `--fail`) is no mark's colour to the eye: `--ok` is 1.5:1 at least from Claude's orange, and `--fail` 60
  degrees of hue at least from the person's violet (in light the two are close in lightness). The dark `--warn` is an
  ochre, not an amber.
- An edit drawn as a diff has its own two washes (`--diff-removed-wash`, a grey between the panel and the hairline;
  `--diff-added-wash`, the value of `--accent-wash`): `--ink` 7:1 and `--muted` 4.5:1 on both. The added wash is 60
  degrees of hue at least from both marks and from `--fail`, but not from `--ok`: pino's accent is green.
- Copper, mask, silk and per-net colours of a board are a second palette, separate from the accent. It comes with the
  views.

## Faces and shape

- Instrument Sans (400, 500, 600) for the interface and Martian Mono (300, 400, 500) for every number, ref, file name,
  key cap and code, from `@fontsource/*` (pinned, latin subset, imported in `renderer/main.tsx`, bundled; the CSP
  stays `font-src 'self' data:`). The family names are written in `shared/fonts.ts` and `tokens.css` alone
  (`shared/fonts.test.ts`). `.num` (in `layout.css`) is the class for what is set in Martian Mono.
- A `border-radius` is one of the four radius tokens or `--radius-full`, `0`, `50%` or `inherit` (chat.css keeps
  12px and 3px for the person's words); the one shadow is `--float-shadow`: no other `box-shadow` has a blur over 4px.
- A sheet reads only custom properties that `tokens.css` or the sheet itself defines, but for one read with a fallback
  of its own (set from the window).
- No text is dimmed by `opacity`, nothing animates without end, and a sheet that moves something says what it does for
  a person who asked for less motion (`styles/styles.test.ts`).
- The window's sizes are tokens (`--title-h`, `--card-w`, `--dock-w`, `--status-h`); under 1360px the card and the
  dock take their narrow widths.
