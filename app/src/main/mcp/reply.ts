// How a tool answers: its text capped, an error said as an error.

import { capText } from './schemas'

export interface Reply {
  [key: string]: unknown
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

export const text = (said: string): Reply => ({ content: [{ type: 'text', text: capText(said) }] })
export const refused = (said: string): Reply => ({ ...text(said), isError: true })
