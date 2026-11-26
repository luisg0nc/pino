---
paths:
  - "app/src/main/onboard.ts"
  - "app/src/main/onboard.test.ts"
  - "app/src/main/projects/**"
  - "app/src/shared/slots.ts"
  - "app/src/shared/projectName.ts"
  - "app/src/renderer/state/onboard.ts"
  - "app/src/renderer/ui/onboard/**"
  - "app/src/renderer/ui/ink/**"
  - "app/e2e/onboard.spec.ts"
---

# A new project: the page, the folder, and the first prompt

Paths are written from `app/`, or short under `app/src/` and `app/src/renderer/` (see "Rules by area" in the root `CLAUDE.md`).

## The page (`ui/onboard/`, `state/onboard.ts`)

- The New project page (`NewProject.tsx`, torno's page of slots) is shown by "New project…", the New project card,
  and a workspace with no projects. At the left the name, "What it does" with photos and doodles beside it, and a
  tile for each slot not opened yet: Power, Connections, Size and shape, Parts I have, Fab and assembly, Rules,
  Links and PDFs. At the right (`DraftPane.tsx`) the first prompt as main writes it, asked again 300 ms after a change,
  what will be made, the model and effort, Start and "or make it without starting Claude".
- **The draft is the window's** and is never on disk. It is dropped with the workspace. Escape leaves the page and
  keeps it; Discard empties it, asking first when it holds something. Opening a slot adds no row, but for Fab, which
  starts as `DEFAULT_FAB`.
- Rows are kept as typed. One that `checkPower`, `checkConnection`, `checkPartHad` or `checkFab` (`shared/slots.ts`,
  the rule main holds a request to as well) refuses says why under it and holds both buttons; a row nothing was typed
  in is left out.
- **The stock check** (`parts.ts`): an LCSC number is looked up 400 ms after the last key, once per number, through
  `parts:lookup` (the engine's `parts get`, as Claude's `parts` tool). An answer for a number the row no longer holds
  is dropped. A stock that cannot be checked says why and holds nothing back.
- A dropped file is taken by its path; main's dialog is the only source of a path whose bytes the window may ask for.
  A pasted picture with no file is kept as the PNG the window scaled.
- On the ink pad a doodle's ink over a photo is `OVER_PICTURE` (`ink/strokes.ts`), whatever the theme; without a
  picture it is the theme's `--ink`.

## Making it (`main/projects/`, `ui/onboard/make.ts`)

- `project:create` makes the folder (`create.ts`, see `workspace-writes`), then lists the workspace and opens the
  project. A failure after the folder is there says "<name> was made, but …": it is never made again.
- The slots become the person's cards in frames (`cards/start.ts`, `START_FRAMES`); the description and pictures live
  in `brief.md` and `reference/`, and are no cards.
- A part's stock reading is never taken from the window: main keeps those it gave this run, for an hour
  (`readings.ts`), for the card and the first prompt.

## The first prompt (`main/onboard.ts`, `project:onboard`)

- After `create` the window shows the project and calls `project.onboard(projectId, draft)` (`OnboardDraft` in
  `shared/bridge.ts`: the slots, and the photos, doodles and PDFs by their `reference/` file with the note, the
  pictures with their bytes). It rejects, doing nothing, for a project that is not the open one, one with a session,
  one already being onboarded, and a draft that is not what it may be: all of it is checked before any session
  starts. Then it starts the session on `OnboardDraft.choice` (held to `agentChoiceOf`), counts the Brief as told
  (`markTold` with what `cardsLine` would tell, so the prompt's line says "(0 new)"; a failure of that stops
  nothing), and sends one prompt with `Sessions.sendBlocks`: the text of `onboardPrompt`, then the pictures.
- The text is the one form (pino starts Claude with no skill of its own): the description, what was given (photos,
  doodles, PDFs), each slot that holds something, then that all of it is kept and what to settle before `board.py`
  (`SETTLE`), asked in one round, only what would change the board, with parts checked and findings written as cards
  first. A part's line has the reading main gave, or "stock not checked". A doodle drawn over a photo is told as the
  person's ink over that photo, with no grid; which it is, is the flag `OnboardDraft.items[].over`, never the note's
  words. `onboard.test.ts` holds the text and that every tool it names is one of pino's.
- `previewPrompt` writes the same text from the page as it is, writing and starting nothing; what `onboard` would
  refuse is left out, not refused. While the description is empty the pane shows `BLANK_DESCRIPTION` in its place.
- The pictures are the window's. Main has no decoder (Electron's `nativeImage` has none for WebP, and the window already
  decodes), so the window scales to a long edge of 1280 px and sends PNG or JPEG bytes; main reads the size from the
  header (`checkedImage`) and attaches only a PNG or JPEG of at most 2000 px and 3.75 MB (`MAX_IMAGE_BYTES`; base64 of
  it is 5 MB, the API's limit). One that is not is left out and the
  text says "not attached: read reference/<file>". Photos, then doodles, at most 6 in all (`MOST_IMAGES`); a further
  one is named in the text as not attached. Notes are one line each.
- Each picture comes after a text block naming it ("Picture 2: reference/doodle-1.png (the person's doodle): <note>"),
  because the CLI gives the model no file name for an image; the main text says "(attached: picture N)". The
  transcript's user item shows the first text only: a later text right before an image is a caption and is not shown.
- The answer has `prompt` (as sent) and `held` (every picture "not attached: read reference/<file>"). A session that
  cannot be started (Claude Code is not there, the trust question) is not a rejection: `sessionId` is null with the
  reason, and a prompt that cannot be sent is not one either. The window keeps `held` for the project: the dock says
  why, and the next session started takes it as text (`StartChat.tsx`, `SessionDock.tsx`). A CLI that starts and
  leaves without taking the prompt up is not noticed: its transcript says why it ended.
- Tested: `onboard.test.ts` (the text, the pictures, the rules) and `e2e/onboard.spec.ts` (the page, the stand-in
  agent and engine).
