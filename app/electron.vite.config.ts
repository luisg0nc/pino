import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The window's bundle carries other people's code without their notices: this writes `third-party-licenses.txt` beside
 * it, each bundled package with its licence, and fails the build for one that has no licence file.
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle() {
      const found = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        // The package's folder: the last node_modules in the path, with its scope.
        const folder = /^\0?(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(id)?.[1]
        if (!folder || !existsSync(join(folder, 'package.json'))) continue
        const { name, version } = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { name: string; version: string }
        const file = readdirSync(folder).find((entry) => /^licen[cs]e/i.test(entry))
        if (!file) this.error(`${name} is bundled and has no licence file`)
        found.set(`${name} ${version}`, readFileSync(join(folder, file), 'utf8').trim())
      }
      const text = [...found].sort(([a], [b]) => a.localeCompare(b)).map(([title, licence]) => `${title}\n\n${licence}\n`)
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source: text.join(`\n${'-'.repeat(80)}\n\n`) })
    }
  }
}

// Layout follows electron-vite's convention: src/main, src/preload, src/renderer.
// Dependencies of main and preload are left external (the default), so native
// modules such as node-pty load from node_modules at run time.
export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), thirdPartyLicenses()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
