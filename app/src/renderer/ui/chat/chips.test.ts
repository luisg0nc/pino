import { expect, it } from 'vitest'
import { point } from '../../../test/marks'
import { chipsFor, pointedIds } from './markChips'

const user = (id: string) => point({ id, label: id, payload: `part R1 ${id}` })
const agent = (id: string, label: string) => point({ id, label, author: 'agent', payload: `part ${label}` })

it('gives hollow chips for a sent prompt, by author colour, and drops ids it does not know', () => {
  expect(chipsFor(['M1', 'M9', 'M2'], [user('M1'), agent('M2', 'U2')])).toEqual([
    { id: 'M1', label: 'M1', author: 'user', hollow: true, title: user('M1').payload },
    { id: 'M2', label: 'U2', author: 'agent', hollow: true, title: agent('M2', 'U2').payload }
  ])
})

it('gives filled chips where Claude has just pointed', () => {
  expect(chipsFor(['M2'], [agent('M2', 'U2')], false)).toMatchObject([{ id: 'M2', hollow: false }])
})

it("reads the ids Claude's point made out of the tool's answer", () => {
  expect(pointedIds('Pointed: M7 U2, M8 U1, M9 gap 0.83 mm. They are orange in the view.')).toEqual(['M7', 'M8', 'M9'])
  // the answer as the CLI hands it over: the tool's content, as it came
  expect(pointedIds(JSON.stringify([{ type: 'text', text: 'Pointed: M1 U2.1. They are orange in the view.' }]))).toEqual(['M1'])
  expect(pointedIds('No part U9. Nearest: U1, U2')).toEqual([])
  expect(pointedIds(undefined)).toEqual([])
})
