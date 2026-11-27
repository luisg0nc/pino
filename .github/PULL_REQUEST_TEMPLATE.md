## What and why

<!-- A few lines. Link the issue: Closes #n. The base is `dev`: `main` holds the last release. -->

## How it was checked

- [ ] `pnpm test`
- [ ] `pnpm test:e2e` (needs a desktop; say if you could not run it)
- [ ] `pnpm -C app typecheck`
- [ ] `bash .claude/hooks/guard-bash.test.sh`
- [ ] `env -u DISPLAY -u WAYLAND_DISPLAY uv run --directory kernel pytest`, if `kernel/` changed
- [ ] Tried by hand with a real `claude`, if the change touches the agent (sessions, prompts, tools, hooks). No test runs the real CLI.

## Docs

- [ ] The README (or `kernel/README.md`) changed if behaviour did
- [ ] The rule in `.claude/rules/` (or the root `CLAUDE.md`) changed if a rule did

## Pictures

<!-- For anything visible, a capture from a hidden window (see .claude/rules/e2e-hidden-window.md; never page.screenshot() on Electron). Light and dark if colours changed. -->

## Three rules to check

- [ ] Nothing new is written in a project folder outside `<project>/.pino/`
- [ ] No test runs a real agent CLI
- [ ] A file copied from torno has its entry in `shared-from-torno.json`
