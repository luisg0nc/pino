// What a session asks of the app's own domain. The session manager is plumbing shared with torno in shape: what a
// board needs the agent to know, and when a turn may end, is answered here, so the engine stage adds both without
// touching the manager.
import type { ProjectInfo } from '../../shared/project'

export interface SessionDomain {
  /** Added to a prompt through its UserPromptSubmit hook (additionalContext); '' adds nothing. */
  promptContext(project: ProjectInfo, prompt: string): Promise<string>
  /** The Stop hook's answer: null lets the turn end; a block sends the agent on with the reason. */
  stopAnswer(project: ProjectInfo): Promise<{ decision: 'block'; reason: string } | null>
}

/** The domain of a pino with no engine: it adds nothing and holds no turn back. */
export const NO_DOMAIN: SessionDomain = {
  promptContext: async () => '',
  stopAnswer: async () => null
}
