# pino.luisg.me

A small landing page for pino, the sibling of torno.luisg.me, for when the repository goes public.

## Why

The repository will be public. torno has a site that says what it is, shows the window and says how to run it; pino
should have the same, so a link to pino lands on a page and not on a README. There is no real session to tell yet
(pino has not been run end to end with the real Claude Code), so the page is smaller than torno's and leans on
screenshots.

## Goals

- One page at `https://pino.luisg.me/`: what pino is, the loop, the window in pictures, what it is for, what you need
  and how to run it, and links to the repository.
- Pictures made by a script from a hidden window, on a copy of Luis's `simple-blinker`, so they can be made again
  when the window changes.
- The look is pino's: solder-mask green, the pin one mark, Instrument Sans and Martian Mono. It reads as torno's
  sibling.

## Non-goals

- No story page ("a part, prompt by prompt") and no manual, until there is a real session to show.
- No README pictures in this round (the same shots can feed them later).
- No new runtime dependency in the app.

## Anti-goals

- A claim the app has not earned. pino has not been checked with the real Claude Code; the page says what it does,
  not how well, and has no "what goes well" list.
- Anything personal in a picture: no home path, no name, no other board of Luis's.
- A window on Luis's desktop while the pictures are made.

## Approaches

- **A. Copy torno's site and cut it down (picked).** Copy `site/index.html`, `site/assets/site.css`, `site.js`,
  `app/scripts/build-site.mjs`, `app/src/site.test.ts`, `.github/workflows/pages.yml` and `app/scripts/readme-images.py`
  from torno, then adapt; the pictures come from pino's own `shots.spec.ts`. Sibling
  look, least work, and the shared code stays traceable in `shared-from-torno.json`.
- B. A fresh design with mocked directions. More distinctive, but a separate thing from torno's site and slower;
  Luis asked for something like torno's.
- Cloudflare Pages instead of GitHub Pages: not needed once the repository is public; GitHub Pages is how torno does
  it.

## The page

Sections, in order:

1. **Hero.** One line on what pino is ("Claude Code designs your circuit board from a Python file", or close), the
   Board view of `simple-blinker` routed, light and dark pictures like torno's hero.
2. **The loop.** Four steps, as torno's: you describe the board or mark a part; Claude Code edits `board.py`; the
   engine builds the KiCad project and runs the checks; pino draws it and tells Claude what changed and what failed.
3. **The window.** The four tabs, one picture each: Brief, Schematic, Board, 3D.
4. **What it is for.** Two or four layers, about a hundred parts, JLCPCB parts in stock, fab files (Gerbers, drills,
   BOM, CPL) you upload yourself. Linux only.
5. **What you need and how to run it.** Linux, Node 22.12 or later with pnpm, uv, KiCad 10 for the checks and the
   routing, and a Claude Code login. Then clone, `pnpm install`, `scripts/pino`.
6. **Links.** The repository, its issues, and torno as the sibling.

A square link preview (1200 x 1200, the mark in the middle) and the og and twitter tags, as torno #329.

## The pictures

- A new group in pino's own `app/e2e/shots.spec.ts` (the one spec allowed to take pictures; torno's `readme.spec.ts`
  is the model) launches the built app with `PINO_TEST=1` (hidden window,
  temp profile, stand-in agent, recorded parts answers, offline), sizes the window, opens each tab and captures it
  with `webContents.capturePage()`. It does not use `page.screenshot()`.
- It runs only when `PINO_SITE_BOARD` names a board folder, so CI and `pnpm test:e2e` skip it.
- It copies that board into a temp workspace (`/tmp/<plain name>/boards/simple-blinker`) with its build and route
  but without `.pino/chat`, `session.json` or marks, so the title bar shows no home path.
- `simple-blinker` has no `brief.md` (made before the Brief). The copy gets a short `brief.md` and a few cards written
  by the spec (a requirement, a part, a power budget, a decision), so the Brief picture has something on it. My call.
- A script crops and composes the pictures into `docs/images/` and the link preview. Raw captures stay out of git.

## Hosting

- `.github/workflows/pages.yml` deploys `site/` on a push to `main` that touches the site or its pictures. GitHub
  Pages set to deploy from Actions, custom domain `pino.luisg.me` (a `site/CNAME` file).
- DNS: a `pino.luisg.me` CNAME to `luisg0nc.github.io`, DNS only.

## Order, and what stays with Luis

1. Build the page and the pictures on a branch; preview it locally (`python3 -m http.server -d site`) and show Luis.
2. Merge after green CI and the review.
3. Luis: making the repository public, turning Pages on, the DNS record, and Enforce HTTPS once the certificate is
   issued.

## Second round (branch `site-story`)

The blinker was made with the real Claude Code in three prompts, so the page now has its story, and Luis asked for
more of torno's craft:

- **A board, prompt by prompt.** torno's story engine (`site/assets/story.js`) draws a board in 2D in place of
  torno's 3D part. The board is the blinker's own builds (h4, h5, h7, h9) and routes (r1 to r3), written into
  `site/stories/simple-blinker.board.js` by `app/scripts/story-board.mjs` with the app's board reader, and drawn in
  the Board view's look. The lines are pino's, from `builds.json`, `result.json` and `route.json`; the prompts are
  short versions of Luis's three. What Claude Code said back is left out, apart from one line saying it asked a
  question before the first build.
- **The loop has five steps**: you describe the board, Claude Code edits `board.py`, the engine builds and checks it,
  the router lays the copper, pino draws it and tells Claude. The "no tools by hand" line is gone.
- **Claude Code soldering in the heading**, drawn from its pixel mark as torno's is: it touches the iron to an LED's
  joint, the solder flows and smokes, it lifts the iron, and the LED blinks three times. It plays once; with motion
  reduced it is a still drawing of the joint being made.
- **torno's mark** on the link to torno, **the window's pictures two across** (one on a phone), each opening full size
  in a light box, and **an author section** linking luisg.me with one line from that page.

## Left to the builder

The exact copy of each section (short, plain, no em dashes, humanized), the crop of each picture, and how much of
torno's `site.js` (reveal on scroll, theme pictures) pino needs.
