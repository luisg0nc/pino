// The time now, followed by the second while something is being timed.

import { useEffect, useState } from 'react'

export function useNow(timing: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!timing) return
    setNow(Date.now())
    const beat = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(beat)
  }, [timing])
  return now
}
