---
paths:
  - "app/src/main/own.ts"
  - "app/src/main/own.test.ts"
  - "app/src/main/own.order.test.ts"
  - "app/src/main/ignored.ts"
  - "app/src/main/ignored.test.ts"
  - "app/src/main/atomic.ts"
  - "app/src/main/atomic.test.ts"
  - "app/src/main/marks/**"
  - "app/src/main/builds.ts"
  - "app/src/main/artifacts.ts"
---

# What pino writes in a project, and `.pino` itself

## Global Constraints (root `CLAUDE.md`)

- Never write inside a project folder except under `<project>/.pino/`. This stage has no exceptions. A later stage
  that adds one (a new project's folder, the fab output folder, `board.py` written by the agent itself) says it here
  in the same commit.
- Whatever the agent writes in the project folder is the agent's own write, asked of the person by Claude Code's
  permissions; pino does not make it.

## What is written, and by whom

- **pino's main** writes, besides the chat's files, one file in a project: `.pino/marks/marks.json` (`marks/file.ts`),
  through `ownFolder` and `writeFileAtomic`, and it is its only writer (`marks/store.ts` takes one change at a time).
  A file there that cannot be read is renamed `marks.json.bad-<n>` and said; it is never overwritten.
- **The engine** writes `.pino/build/`, `.pino/routes/`, `.pino/trials/`, `.pino/kicad/`, `builds.json` and
  `routes.json` itself. Before main asks it to build, `.pino` and those folders must be the project's own
  (`builds.ts`, `whyNotOwn`): through a link it would write outside the project.
- A build's files are read only from inside its own folder, through no link (`artifacts.ts`).

## The write guard (`app/src/main`)

- **`.pino` is named from one place** (`APP.folder`, through `own.ts`'s `FOLDER`), and every write under it goes
  through `ownFolder(dir)` first (`writeOwn` for a file written whole): a link or a file in its place is refused with
  a plain reason, nothing is written, and the window is told once (`onNotOwn`, wired in `index.ts`). What only reads,
  or says the reason somewhere else, asks `whyNotOwn`, which does not use up that one time.
- The folders pino keeps under it are held to the same rule by the same function, named after the folder:
  `ownFolder(dir, 'chat')`. It is asked before every write into such a folder and before every delete in it. A link or
  a file in its place is refused, nothing is written or deleted where it leads, and the window is told once for each
  such folder, by itself (`inside` of the listener).
- **`.pino/.gitignore` has one writer**, `ignored.ts` `ensureIgnored(dir, lines)`: it adds the lines that are
  missing at the end, makes the file when there is none, never removes or rewrites what is there, and adds nothing
  against a line the person negated. A conversation put on file asks it for `session.json`, a chat's log for `chat/`.
- A file is written whole or not at all (`atomic.ts` `writeFileAtomic`), through a temp file of this write alone.
