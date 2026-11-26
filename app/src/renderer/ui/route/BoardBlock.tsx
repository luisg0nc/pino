import { boardFacts } from '../../../shared/checks'
import type { ViewModel } from '../../state/viewModel'
import { Row, Section } from './Section'

/** The board in numbers, from its own file. */
export function BoardBlock({ model }: { model: ViewModel }) {
  const facts = boardFacts(model.board, model.result)
  return (
    <Section title="Board" count={`${facts.layers} layers`}>
      <Row name="Size" value={<span className="num">{facts.size}</span>} />
      <Row name="Parts, nets" value={<span className="num">{`${facts.parts}, ${facts.nets}`}</span>} />
      {facts.copper && <Row name="Copper, vias" value={<span className="num">{facts.copper}</span>} />}
    </Section>
  )
}
