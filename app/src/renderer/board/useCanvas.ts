// What a drawn view needs of the page: its size in CSS pixels, the screen's pixel ratio, and whether the theme is dark,
// each followed as it changes.

import { useEffect, useState, type RefObject } from 'react'

export interface Size {
  w: number
  h: number
  dpr: number
}

export function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0, dpr: 1 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const read = () => {
      const w = element.clientWidth
      const h = element.clientHeight
      const dpr = window.devicePixelRatio || 1
      setSize((s) => (s.w === w && s.h === h && s.dpr === dpr ? s : { w, h, dpr }))
    }
    const watcher = new ResizeObserver(read)
    watcher.observe(element)
    window.addEventListener('resize', read)
    read()
    return () => {
      watcher.disconnect()
      window.removeEventListener('resize', read)
    }
  }, [ref])
  return size
}

const DARK = '(prefers-color-scheme: dark)'

export function useDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK).matches)
  useEffect(() => {
    const query = window.matchMedia(DARK)
    const changed = () => setDark(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  return dark
}

/** Sizes a canvas's own pixels to its box; true when it changed (which also clears it). */
export function sized(canvas: HTMLCanvasElement, size: Size): void {
  const w = Math.max(1, Math.round(size.w * size.dpr))
  const h = Math.max(1, Math.round(size.h * size.dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
}

/** Runs `frame` with 0 to 1 over `ms`, once; with reduced motion it is at its end at once. Returns what stops it. */
export function once(ms: number, frame: (t: number) => void, delay = 0): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    frame(1)
    return () => {}
  }
  let handle = 0
  let from: number | null = null
  const step = (now: number) => {
    from ??= now
    const t = Math.max(0, Math.min(1, (now - from - delay) / ms))
    frame(t)
    if (t < 1) handle = requestAnimationFrame(step)
  }
  frame(0)
  handle = requestAnimationFrame(step)
  return () => cancelAnimationFrame(handle)
}
