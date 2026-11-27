// A small LED blinker, made in pino with the real Claude Code in three prompts. The prompts are short versions of the
// ones it was made with. Every line is what pino said of a build or a route of the project (its builds.json, each
// build's result.json, each route's route.json), and every state of the board is one of them, drawn from
// simple-blinker.board.js. What Claude Code said back is left out.
;(function () {
  'use strict'
  var steps = [
    {
      you: 'A button, a 9 V battery and an LED that blinks three times.',
      note: 'No build yet. Claude Code asks a question first.',
      head: 'no board.py yet',
      hold: 2.6
    },
    {
      you: 'Dive in, go ahead.',
      lines: [
        { say: 'h1 failed', kind: 'fail', rev: 'h1', wait: 0.3 },
        { say: 'h2 failed', kind: 'fail', rev: 'h2', wait: 0.3 },
        { say: 'h3 failed', kind: 'fail', rev: 'h3', wait: 0.5 },
        { say: 'h4: 2 errors, 40 unrouted', head: '2 errors', kind: 'warn', rev: 'h4', busy: 'building h4', dur: 2.2, wait: 1.1, state: { build: 'h4' } },
        { say: 'h5: 0 errors, 40 unrouted', head: '0 errors', kind: 'ok', rev: 'h5', busy: 'building h5', dur: 1.8, wait: 1, state: { build: 'h5' } },
        { say: 'Route r1: 15 of 15 nets, 2 copper errors', head: 'routed, 2 copper errors', kind: 'warn', rev: 'h6', busy: 'routing h5', dur: 2.4, wait: 1.6, state: { route: 'r1', errors: true } },
        { say: 'h7: rules changed, copper stale', head: 'copper stale', kind: 'warn', rev: 'h7', busy: 'building h7', dur: 1, wait: 0.9, state: { build: 'h7', stale: true, errors: false } },
        { say: 'Route r2: 15 of 15 nets, DRC clean', head: 'routed, DRC clean', kind: 'ok', rev: 'h8', busy: 'routing h7', dur: 2.4, wait: 0, state: { route: 'r2', stale: false } }
      ],
      hold: 2.6
    },
    {
      before: [
        { say: 'h9 to h11: labels moved, copper stale', head: 'copper stale', kind: 'warn', rev: 'h11', busy: 'building h9', dur: 1.4, wait: 0.4, state: { build: 'h9', stale: true } }
      ],
      you: 'Can you reroute, please?',
      lines: [
        { say: 'Route r3: the copper of r2 kept, DRC clean', head: 'routed, DRC clean', kind: 'ok', rev: 'h12', busy: 'routing h11', dur: 1.4, wait: 0, state: { route: 'r3', stale: false } }
      ],
      hold: 3.4
    }
  ]

  PinoStory.add('simple-blinker', {
    board: 'simple-blinker',
    name: 'simple-blinker',
    intro: 'New project, simple-blinker. The folder is empty.',
    steps: steps
  })
})()
