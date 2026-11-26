// Everything the renderer may ask of main, and the types both sides share for it.

/** `chat`: Claude Code run headless, drawn by pino. `terminal`: as a terminal would run it; pino has no such view yet. */
export type AgentView = 'chat' | 'terminal'

export type SessionStatus = 'starting' | 'idle' | 'working' | 'needs_input' | 'exited'
