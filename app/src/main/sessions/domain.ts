// What a session asks of the app's own domain. The session manager is plumbing shared with torno in shape: what a
// board needs the agent to know, and when a turn may end, is answered here (main/domain.ts), without the manager
// knowing anything of boards.
import type { TurnBuilds } from '../../shared/chat'
import type { ProjectInfo } from '../../shared/project'

export interface PromptContext {
  /** Added to the prompt through its UserPromptSubmit hook (additionalContext); '' adds nothing. */
  text: string
  /** The marks the text carries: they stand beside the prompt in the chat. */
  sentMarkIds: string[]
  /** Called once the hook has its answer: the agent has the context then. */
  delivered?: () => Promise<void>
}

export interface SessionDomain {
  /** `folded`: the CLI took the prompt up inside the turn at work, so that no turn begins with it. */
  promptContext(project: ProjectInfo, prompt: string, folded?: boolean): Promise<PromptContext>
  /** The Stop hook's answer, for a turn that took up `prompts`: null lets it end; a block sends the agent on with the reason. */
  stopAnswer(project: ProjectInfo, prompts: readonly string[]): Promise<{ decision: 'block'; reason: string } | null>
  /** The builds a turn made since `since` (ms) for its `prompts`, kept on the item of the turn that ends; none to say it made none. */
  turnBuilds?(project: ProjectInfo, since: number, prompts: readonly string[]): TurnBuilds | undefined
}

const NOTHING = (): PromptContext => ({ text: '', sentMarkIds: [] })

/** A domain that adds nothing and holds no turn back. */
export const NO_DOMAIN: SessionDomain = {
  promptContext: async () => NOTHING(),
  stopAnswer: async () => null
}
