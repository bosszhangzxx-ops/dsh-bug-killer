import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

  it('lists project directories through the host boundary', async () => {
    const workspace = await mkdtemp(path.join(process.cwd(), '.tmp-bug-killer-rpc-'))
    try {
      await mkdir(path.join(workspace, 'server'))
      const result = await handler(RPC_ENDPOINTS.listDirectories, {
        rootCwd: workspace,
        directory: workspace,
      }, new AbortController().signal)
      expect(result).toMatchObject({
        ok: true,
        value: { directories: [{ name: 'server' }] },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('probes a log through the selected project boundary', async () => {
    const workspace = await mkdtemp(path.join(process.cwd(), '.tmp-bug-killer-probe-rpc-'))
    try {
      await mkdir(path.join(workspace, 'logs'))
      await writeFile(path.join(workspace, 'logs', 'app.log'), 'started\n', 'utf8')
      const result = await handler(RPC_ENDPOINTS.probe, {
        rootCwd: workspace,
        cwd: workspace,
        logPath: 'logs/app.log',
      }, new AbortController().signal)
      expect(result).toMatchObject({
        ok: true,
        value: { exists: true, relativePath: 'logs/app.log', size: 8 },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
