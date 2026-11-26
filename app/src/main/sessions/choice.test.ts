import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { findCommand } from './choice'

it('finds a command: itself when it is a path, else the first file on PATH that can be run', () => {
  const bin = mkdtempSync(join(tmpdir(), 'pino bin '))
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n')
  chmodSync(join(bin, 'claude'), 0o755)
  // A folder of that name is not a command, nor a file that cannot be run.
  mkdirSync(join(bin, 'other'))
  mkdirSync(join(bin, 'other', 'claude'))
  writeFileSync(join(bin, 'other', 'plain'), '')
  expect(findCommand('claude', `${join(bin, 'other')}:${bin}`)).toBe(join(bin, 'claude'))
  expect(findCommand('plain', `${join(bin, 'other')}:${bin}`)).toBeNull()
  expect(findCommand('claude', '')).toBeNull()
  expect(findCommand(join(bin, 'claude'))).toBe(join(bin, 'claude'))
  expect(findCommand(process.execPath)).toBe(process.execPath)
})
