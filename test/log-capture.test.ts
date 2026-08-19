import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogCaptureManager } from '../src/log-capture.ts'

const TEMP_PREFIX = '.tmp-bug-killer-capture-'

describe('LogCaptureManager', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(process.cwd(), TEMP_PREFIX))
    await mkdir(path.join(workspace, 'logs'), { recursive: true })
  })

  afterEach(async () => {
    if (workspace !== '' && path.basename(workspace).startsWith(TEMP_PREFIX)) {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('captures only bytes appended after reproduction starts', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, '2026-08-19 INFO old line\n', 'utf8')
    const manager = createManager()

    const started = await manager.start('session-1', workspace, 'logs/application.log')
    await appendFile(logPath, '2026-08-19 INFO [BUG_KILLER:BK-1] step=load result=ok\n', 'utf8')
    await appendFile(logPath, '2026-08-19 WARN state was not updated\n', 'utf8')
    const result = await manager.finish('session-1')

    expect(started.startOffset).toBeGreaterThan(0)
    expect(result.empty).toBe(false)
    expect(result.logText).toContain('step=load result=ok')
    expect(result.logText).toContain('state was not updated')
    expect(result.logText).not.toContain('old line')
    expect(manager.status('session-1').active).toBe(false)
  })

  it('keeps the capture active when no new log was written', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, 'baseline\n', 'utf8')
    const manager = createManager()
    await manager.start('session-empty', workspace, logPath)

    const empty = await manager.finish('session-empty')
    expect(empty.empty).toBe(true)
    expect(manager.status('session-empty').active).toBe(true)

    await appendFile(logPath, 'later line\n', 'utf8')
    const retry = await manager.finish('session-empty')
    expect(retry.empty).toBe(false)
    expect(retry.logText).toBe('later line\n')
  })

  it('recovers from truncation or log rotation by reading the current file', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, `${'old'.repeat(100)}\n`, 'utf8')
    const manager = createManager()
    await manager.start('session-rotate', workspace, 'logs/application.log')

    await writeFile(logPath, '2026-08-19 INFO new file after rotation\n', 'utf8')
    const result = await manager.finish('session-rotate')

    expect(result.rotated).toBe(true)
    expect(result.logText).toContain('new file after rotation')
    expect(result.warnings.join(' ')).toContain('截断或轮转')
  })

  it('detects a replaced log file even when the replacement is larger than the old offset', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, 'old-old-old\n', 'utf8')
    const manager = createManager()
    await manager.start('session-replaced', workspace, 'logs/application.log')

    await rename(logPath, `${logPath}.1`)
    await writeFile(logPath, 'NEW-FILE-FIRST-LINE\nNEW-FILE-SECOND-LINE\n', 'utf8')
    const result = await manager.finish('session-replaced')

    expect(result.rotated).toBe(true)
    expect(result.logText).toContain('NEW-FILE-FIRST-LINE')
    expect(result.logText).toContain('NEW-FILE-SECOND-LINE')
  })

  it('keeps the beginning and end when the new range exceeds the limit', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, '', 'utf8')
    const manager = createManager({ maxCaptureBytes: 65_536 })
    await manager.start('session-large', workspace, 'logs/application.log')
    await appendFile(logPath, `HEAD-LINE\n${'x'.repeat(90_000)}\nTAIL-LINE`, 'utf8')

    const result = await manager.finish('session-large')
    expect(result.omittedBytes).toBeGreaterThan(0)
    expect(result.logText).toContain('HEAD-LINE')
    expect(result.logText).toContain('TAIL-LINE')
    expect(result.logText).toContain('省略中间')
  })

  it('discovers recent log files but skips dependency directories', async () => {
    await writeFile(path.join(workspace, 'logs', 'application.log'), 'app\n', 'utf8')
    await mkdir(path.join(workspace, 'module', 'logs'), { recursive: true })
    await writeFile(path.join(workspace, 'module', 'logs', 'service.log'), 'service\n', 'utf8')
    await mkdir(path.join(workspace, 'node_modules', 'fake'), { recursive: true })
    await writeFile(path.join(workspace, 'node_modules', 'fake', 'ignored.log'), 'ignore\n', 'utf8')

    const found = await createManager().discoverLogs(workspace)
    const names = found.map(entry => entry.relativePath)
    expect(names).toContain('logs/application.log')
    expect(names).toContain('module/logs/service.log')
    expect(names).not.toContain('node_modules/fake/ignored.log')
  })

  it('probes whether the selected log exists and reports its current size', async () => {
    const missing = await createManager().probeLog(workspace, 'logs/application.log')
    expect(missing).toEqual({
      exists: false,
      relativePath: 'logs/application.log',
      size: 0,
      modifiedAt: 0,
    })

    await writeFile(path.join(workspace, 'logs', 'application.log'), 'ready\n', 'utf8')
    const ready = await createManager().probeLog(workspace, 'logs/application.log')
    expect(ready.exists).toBe(true)
    expect(ready.relativePath).toBe('logs/application.log')
    expect(ready.size).toBe(6)
    expect(ready.modifiedAt).toBeGreaterThan(0)
  })

  it('rejects an absolute log path outside the DSH workspace', async () => {
    const outside = path.join(process.cwd(), `.tmp-bug-killer-outside-${Date.now()}.log`)
    await writeFile(outside, 'outside\n', 'utf8')
    try {
      await expect(createManager().start('session-outside', workspace, outside))
        .rejects.toMatchObject({ code: 'path-outside-workspace' })
    } finally {
      await rm(outside, { force: true })
    }
  })

  it('redacts secrets before returning captured evidence', async () => {
    const logPath = path.join(workspace, 'logs', 'application.log')
    await writeFile(logPath, '', 'utf8')
    const manager = createManager()
    await manager.start('session-secret', workspace, 'logs/application.log')
    await appendFile(
      logPath,
      'Authorization: Bearer abc.def.ghi\npassword=my-password\nurl=/callback?access_token=secret-value&ok=1\n',
      'utf8',
    )

    const result = await manager.finish('session-secret')
    expect(result.logText).not.toContain('abc.def.ghi')
    expect(result.logText).not.toContain('my-password')
    expect(result.logText).not.toContain('secret-value')
    expect(result.logText.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

function createManager(overrides: Partial<ConstructorParameters<typeof LogCaptureManager>[0]> = {}): LogCaptureManager {
  return new LogCaptureManager({
    maxCaptureBytes: 1_048_576,
    maxDiscoveryDepth: 4,
    redactSecrets: true,
    ...overrides,
  })
}
