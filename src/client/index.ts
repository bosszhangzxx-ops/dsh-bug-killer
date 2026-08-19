import type { Context } from '@deepseek-ai/cordis'
import { createBugKillerButton } from './bug-killer-button.tsx'
import { injectStyles } from './styles.ts'
import type { ClientContextLike } from './types.ts'

const NAMESPACE = 'dsh-bug-killer'

export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const client = ctx as unknown as ClientContextLike
  injectStyles()
  const component = createBugKillerButton(client.connection)
  client.slots.inject('conversation.input.right', () => client.slots.register(
    {
      name: 'conversation.input.right',
      id: NAMESPACE,
      order: 25,
    },
    component,
  ))
}
