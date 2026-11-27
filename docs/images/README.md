# Pictures of the landing page

The pictures here are made, not taken. The `site` group of `app/e2e/shots.spec.ts` drives the built app in a hidden
window, with the real engine and the stand-in agent, and captures it once a launch. `app/scripts/site-images.py` crops
and quantizes the captures and draws the link preview. The page (`site/index.html`) gets them from
`app/scripts/build-site.mjs`.

## What you need

- A board that is built and routed, in a folder with its `board.py` and `.pino/`. The pictures here are of a small LED
  blinker from the author's own boards, which is not in this repository. The spec only reads the folder: each launch
  works on a copy in the temporary folder, without its conversations, session and marks, with a short `brief.md` and
  four cards that the spec writes. The cards are the person's own, so none puts words in Claude's mouth.
- uv, KiCad 10 and the engine's environment (`uv sync` in `kernel/`). Nothing is routed again: the route the folder
  brought is the one drawn. No part is looked up, so a part card says its stock was not checked.
- `resvg` on `PATH`, for the mark in the link preview.

## To remake them

From the repository root, with a folder for the captures outside the repository:

```sh
pnpm -C app build
PINO_SITE_BOARD=<board folder> PINO_SHOTS=<captures folder> pnpm -C app exec playwright test e2e/shots.spec.ts -g site
uv run --with pillow python app/scripts/site-images.py <captures folder> docs/images
```

Look at every picture before you commit it: nothing personal on screen. The spec fails if the title bar or the
window's text holds your home folder. If a picture shows something else than before, change its alt text and caption
in `site/index.html`, and its `width` and `height` if the size changed (`app/src/site.test.ts` holds those).

## The pictures

| File | What it shows |
|---|---|
| `hero.png`, `hero-dark.png` | The Board view, routed, in the light and the dark theme: the view alone, from its tabs to just under the board. |
| `brief.png` | The Brief tab: the words and the four cards. The whole window. |
| `schematic.png` | The Schematic tab. The whole window. |
| `board.png` | The Board tab, routed. The whole window. |
| `3d.png` | The 3D tab. The whole window. |
| `social-preview.png` | 1200 x 1200, the page's link preview (`og:image`): the mark, the name and a line on the paper grey. |

The captures are 1600 x 1000 (`PINO_TEST_SIZE`). The raw ones are not committed.
