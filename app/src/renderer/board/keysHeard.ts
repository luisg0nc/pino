// Whether a key press belongs to a field, a list or the session pane, and is then not the view's (ui/typing.ts).

import { TYPING } from '../ui/typing'

export const typingIn = (target: EventTarget | null): boolean => target instanceof Element && target.closest(TYPING) !== null
