# pino

pino is meant to be a Linux desktop workbench where Claude Code designs printed circuit boards from a Python file,
while you describe the board and point at what to change. It is a sibling of
[torno](https://github.com/luisg0nc/torno), the same kind of workbench for CAD parts.

This is stage 2, the app shell. It has no engine yet, so a project opens with three empty views and a Claude Code
chat, and no board gets built or drawn.

## Requirements

- Linux
- Node 22.12 or later, and pnpm
- [Claude Code](https://claude.com/claude-code), signed in

## Run

```sh
scripts/pino [folder]
```

A project is one folder. pino installs its dependencies and builds itself on the first run, which also downloads
Electron, and builds again when its sources change. With no folder it opens the one you had open last.

To add pino to your applications menu:

```sh
scripts/pino --install-desktop    # --uninstall-desktop removes it
```

The chat runs Claude Code in the project's folder, with your own login and settings. pino itself writes only into
`.pino/` inside that folder. If a folder brings Claude Code settings of its own, pino asks before the first chat
there.

## Tests

```sh
pnpm install
pnpm test                               # unit tests
pnpm test:e2e                           # builds the app and drives it in a hidden window
pnpm -C app typecheck
bash .claude/hooks/guard-bash.test.sh   # needs jq and perl
```

No test runs the real Claude Code. They use a stand-in, `app/test/fake-agent.mjs`.

## Parts from torno

Much of the plumbing and the look comes from torno. `shared-from-torno.json` lists each copied file, the torno commit
it came from, and whether pino changed it. `node scripts/torno-sync` reports where the two have moved apart. It reads
a torno checkout next to pino, or the one in `PINO_TORNO_DIR`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
