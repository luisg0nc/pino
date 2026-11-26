import { Takeover } from './chat/AskTakeover'

const TITLE = 'This folder has Claude Code settings of its own'

/**
 * pino's question before the first chat in a folder with Claude Code settings of its own, at the foot of the dock as
 * the block an ask is (`Takeover`). Run headless, as the chat runs it, Claude Code loads the hooks and servers such
 * settings name without asking: a cloned project may carry them. The answer is remembered in pino's own data.
 */
export function QuestionCard({ files, asked, disabled, onTrust, onNotNow }: { files: readonly string[]; asked: string; disabled: boolean; onTrust: () => void; onNotNow: () => void }) {
  return (
    <Takeover ask="question" focusKey={asked} className="ask-question" data-where="dock" role="group" aria-label={TITLE}>
      <h4 className="ask-text">{TITLE}</h4>
      <ul className="ask-files">
        {files.map((file) => (
          <li key={file}>
            <span className="num selectable">{file}</span>
          </li>
        ))}
      </ul>
      <p className="ask-why">In the chat, Claude Code loads them without asking, with the commands and servers they name. Start it only if you trust where this folder came from.</p>
      <div className="ask-actions">
        <button type="button" className="button button-primary" disabled={disabled} onClick={onTrust}>
          Trust and start
        </button>
        <button type="button" className="button button-quiet" disabled={disabled} onClick={onNotNow}>
          Not now
        </button>
      </div>
    </Takeover>
  )
}
