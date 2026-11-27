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
  `app/scripts/build-site.mjs`, `app/src/site.test.ts`, `.github/workflows/pages.yml`, and the picture pipeline
  (`app/e2e/readme.spec.ts`, `readme-workspace.ts`, `app/scripts/readme-images.py`) from torno, then adapt. Sibling
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

- A Playwright spec, copied from torno's `readme.spec.ts`, launches the built app with `PINO_TEST=1` (hidden window,
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
- DNS: a `pino.luisg.me` CNAME to `luisg0nc.github.io`, DNS only, added in `~/projects/cloudflare/dns_luisg_me.tf`
  beside `luisg_me_torno_cname`. Luis runs `terraform apply`.

## Order, and what stays with Luis

1. Build the page and the pictures on a branch; preview it locally (`python3 -m http.server -d site`) and show Luis.
2. Merge after green CI and the review.
3. Luis: the leak audit's findings (old commits still hold the fixture skill names; a history rewrite is his call),
   then making the repository public, turning Pages on, the DNS apply, and Enforce HTTPS once the certificate is
   issued.

## Left to the builder

The exact copy of each section (short, plain, no em dashes, humanized), the crop of each picture, and how much of
torno's `site.js` (reveal on scroll, theme pictures) pino needs.
