import type { SessionStatus } from '../../shared/bridge'

/** How the status line and the dock say where the session stands. */
export const sessionWord = (status: SessionStatus | undefined): string =>
  status === undefined ? 'No session' : { starting: 'Starting', idle: 'Idle', working: 'Working', needs_input: 'Needs you', exited: 'Ended' }[status]
