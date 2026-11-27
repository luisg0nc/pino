# Security policy

## Reporting a vulnerability

Please don't open a public issue. Use [private vulnerability
reporting](https://github.com/luisg0nc/pino/security/advisories/new).

Say which commit or release you ran, on which Linux, the steps that show it, and what the finding lets someone do.
You'll get an acknowledgement within a few days. A fix lands on `main` and is noted in the advisory. There is no
bounty: pino is one person's project.

## Supported versions

`main`, which holds the last release, and that release. Nothing older.

## How pino is meant to be safe

So that a report is on target:

- The HTTP server for the agent's tools and hooks binds `127.0.0.1` only, on a port the OS picks.
- Every request carries a per-session token in the `X-Pino-Session` header. It is compared in constant time, and a
  wrong, missing or revoked one is answered 404.
- The token reaches the agent only through its environment, never in an argument or a file, and is never logged.
- pino and its engine write in a project only under `<project>/.pino/`, plus `fab/v<version>/` on a release. Making
  a new project writes one new folder in your folder of boards, and never writes into one that's already there.
- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- The agent is your own `claude`, under your own login. pino uploads nothing. Part lookups go to jlcsearch with
  pino's version and nothing about you, and the first route downloads the router.

## In scope

- Anything that gets around the token or the `127.0.0.1` binding.
- A project's files (a link in `.pino/`, say, or what the engine reads back) making pino or its engine write
  outside the places above.
- Agent output, or a part lookup's answer, that runs code in the window.
- A secret reaching a log or `.pino/chat/`.

## Out of scope

- What Claude Code itself does with your permission settings. pino doesn't change them.
- `board.py` running code when it is built. It is a Python program and pino runs it without a sandbox, so treat
  someone else's board like any other script.
