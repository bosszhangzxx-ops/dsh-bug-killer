import type { RpcResult } from '../contracts.ts'

export interface SlotOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string
  inject?: (sessionId: string) => Record<string, unknown>
}

export interface SlotsLike {
  inject(name: string, register: () => unknown): void
  register(options: SlotOptions, component: unknown): unknown
}

export interface ClientConnectionLike {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<RpcResult<unknown>>
  }
}

export interface ClientContextLike {
  slots: SlotsLike
  connection: ClientConnectionLike
}

export interface InputStateLike {
  draft: string
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

export interface InputActionsLike {
  setDraft(text: string): void
  submit(): void
}

export interface SessionSummaryLike {
  cwd?: string
}

export interface SessionListStateLike {
  byId: Record<string, SessionSummaryLike>
}

export type SessionSelectorHook = <Selected>(
  selector: (state: SessionListStateLike) => Selected,
) => Selected

export interface BugKillerButtonProps {
  sessionId: string
  input: InputStateLike
  inputActions: InputActionsLike
  useSessions: SessionSelectorHook
}
