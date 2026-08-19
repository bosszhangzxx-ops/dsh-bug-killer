import { describe, expect, it } from 'vitest'
import { RPC_ENDPOINTS } from '../src/contracts.ts'
import { createRpcHandler } from '../src/index.ts'
import { LogCaptureManager } from '../src/log-capture.ts'

describe('host RPC boundary', () => {
  const manager = new LogCaptureManager({
    maxCaptureBytes: 1_048_576,
    maxDiscoveryDepth: 4,
    redactSecrets: true,
  })
  const handler = createRpcHandler(manager)

  it('answers health checks', async () => {
    const result = await handler(RPC_ENDPOINTS.health, {}, new AbortController().signal)
    expect(result).toEqual({ ok: true, value: { plugin: 'dsh-bug-killer', ready: true } })
  })

  it('rejects invalid payloads and unknown endpoints with structured errors', async () => {
    const invalid = await handler(RPC_ENDPOINTS.status, null, new AbortController().signal)
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid-request' } })

    const unknown = await handler('unknown/endpoint', {}, new AbortController().signal)
    expect(unknown).toMatchObject({ ok: false, error: { code: 'endpoint-not-found' } })
  })

  it('honours cancellation before touching the filesystem', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await handler(RPC_ENDPOINTS.discover, { cwd: 'D:/missing' }, controller.signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
