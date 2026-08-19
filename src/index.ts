import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { RPC_CHANNEL, RPC_ENDPOINTS, type RpcResult } from './contracts.ts'
import { LogCaptureManager } from './log-capture.ts'
import { BugKillerError } from './security.ts'

export const name = 'dsh-bug-killer'
export const inject = ['connection']

export interface Config {
  maxCaptureBytes: number
  maxDiscoveryDepth: number
  redactSecrets: boolean
}

export const Config: Schema<Config> = Schema.object({
  maxCaptureBytes: Schema.number().default(1_048_576),
  maxDiscoveryDepth: Schema.number().default(4),
  redactSecrets: Schema.boolean().default(true),
})

interface HostConnectionLike {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
      options: { authority: 'loopback' | 'trusted-host' },
    ): () => Promise<void>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: HostConnectionLike
  }
}

export function apply(ctx: Context, config: Config): void {
  const manager = new LogCaptureManager(config)
  ctx.connection.rpc.handle(
    RPC_CHANNEL,
    createRpcHandler(manager),
    { authority: 'loopback' },
  )
}

export function createRpcHandler(manager: LogCaptureManager) {
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    if (signal.aborted) return failure('cancelled', '请求已取消。')
    try {
      const body = asObject(payload)
      switch (endpoint) {
        case RPC_ENDPOINTS.health:
          return success({ plugin: name, ready: true })
        case RPC_ENDPOINTS.discover:
          return success(await manager.discoverLogs(body.cwd))
        case RPC_ENDPOINTS.start:
          return success(await manager.start(body.sessionId, body.cwd, body.logPath))
        case RPC_ENDPOINTS.finish:
          return success(await manager.finish(body.sessionId))
        case RPC_ENDPOINTS.cancel:
          return success(manager.cancel(body.sessionId))
        case RPC_ENDPOINTS.status:
          return success(manager.status(body.sessionId))
        default:
          return failure('endpoint-not-found', `未知的 Bug Killer RPC：${endpoint}`)
      }
    } catch (error) {
      if (error instanceof BugKillerError) return failure(error.code, error.message, error.details)
      return failure('internal', error instanceof Error ? error.message : String(error))
    }
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BugKillerError('invalid-request', 'RPC 请求体必须是对象。')
  }
  return value as Record<string, unknown>
}

function success<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function failure(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): RpcResult<never> {
  return { ok: false, error: { code, message, details } }
}

export { LogCaptureManager } from './log-capture.ts'
export { redactLogSecrets, resolveWorkspaceFile } from './security.ts'
export { buildDiagnosisPrompt, buildInstrumentationPrompt } from './prompts.ts'
export type * from './contracts.ts'
