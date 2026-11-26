import type { PinoBridge } from '../shared/bridge'
import type { PinoState } from './state/store'

declare global {
  interface Window {
    /** Exposed by the preload script; see src/shared/bridge.ts. */
    pino: PinoBridge
    /** Only when main runs with PINO_TEST=1: what the e2e specs read. */
    __pinoTest?: {
      state(): PinoState
    }
  }
}
