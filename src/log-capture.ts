import { open, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  CaptureFinishResult,
  CaptureStartResult,
  CaptureStatusResult,
  DiscoveredLog,
  LogProbeResult,
} from './contracts.ts'
import {
  BugKillerError,
  isPathInside,
  normalizeRelativePath,
  redactLogSecrets,
  requireNonEmptyString,
  resolveWorkspaceFile,
} from './security.ts'

export interface CaptureManagerConfig {
  maxCaptureBytes: number
  maxDiscoveryDepth: number
  redactSecrets: boolean
}

interface ActiveCapture {
  sessionId: string
  workspaceRoot: string
  filePath: string
  relativePath: string
  startOffset: number
  startedAt: number
  device: number
  inode: number
  birthtimeMs: number
}

const DISCOVERY_LIMIT = 100
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.idea', '.pnpm-store', 'node_modules', 'coverage', 'dist', 'build', 'classes',
])

export class LogCaptureManager {
  private readonly sessions = new Map<string, ActiveCapture>()
  private readonly config: CaptureManagerConfig

  constructor(config: CaptureManagerConfig) {
    this.config = {
      maxCaptureBytes: clampInteger(config.maxCaptureBytes, 65_536, 10_485_760, 1_048_576),
      maxDiscoveryDepth: clampInteger(config.maxDiscoveryDepth, 1, 8, 4),
      redactSecrets: config.redactSecrets,
    }
  }

  async discoverLogs(cwdInput: unknown): Promise<DiscoveredLog[]> {
    const cwd = requireNonEmptyString(cwdInput, 'cwd', 4096)
    if (!path.isAbsolute(cwd)) {
      throw new BugKillerError('workspace-invalid', '当前 DSH 工作区路径不是绝对路径。')
    }

    let workspaceRoot: string
    try {
      workspaceRoot = await realpath(cwd)
      if (!(await stat(workspaceRoot)).isDirectory()) throw new Error('not a directory')
    } catch (error) {
      throw new BugKillerError('workspace-unavailable', '无法访问当前 DSH 工作区。', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }

    const found: DiscoveredLog[] = []
    await this.walk(workspaceRoot, workspaceRoot, 0, found)
    return found
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, DISCOVERY_LIMIT)
  }

  async probeLog(cwdInput: unknown, logPathInput: unknown): Promise<LogProbeResult> {
    const requestedPath = requireNonEmptyString(logPathInput, 'logPath', 4096)
    try {
      const resolved = await resolveWorkspaceFile(cwdInput, requestedPath)
      const fileStat = await stat(resolved.filePath)
      if (!fileStat.isFile()) throw new BugKillerError('log-not-file', '日志路径不是普通文件。')
      assertSafeFileSize(fileStat.size)
      return {
        exists: true,
        relativePath: resolved.relativePath,
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
      }
    } catch (error) {
      if (error instanceof BugKillerError && error.code === 'log-not-found') {
        return { exists: false, relativePath: normalizeRelativePath(requestedPath), size: 0, modifiedAt: 0 }
      }
      if (isMissingFileError(error)) {
        return { exists: false, relativePath: normalizeRelativePath(requestedPath), size: 0, modifiedAt: 0 }
      }
      throw error
    }
  }

  async start(sessionInput: unknown, cwdInput: unknown, logPathInput: unknown): Promise<CaptureStartResult> {
    const sessionId = requireNonEmptyString(sessionInput, 'sessionId', 256)
    if (this.sessions.has(sessionId)) {
      throw new BugKillerError('capture-already-active', '这个会话已经在采集日志，请先结束或取消。')
    }

    const resolved = await resolveWorkspaceFile(cwdInput, logPathInput)
    const fileStat = await stat(resolved.filePath)
    assertSafeFileSize(fileStat.size)
    const capture: ActiveCapture = {
      sessionId,
      workspaceRoot: resolved.workspaceRoot,
      filePath: resolved.filePath,
      relativePath: resolved.relativePath,
      startOffset: fileStat.size,
      startedAt: Date.now(),
      device: fileStat.dev,
      inode: fileStat.ino,
      birthtimeMs: fileStat.birthtimeMs,
    }
    this.sessions.set(sessionId, capture)

    return {
      sessionId,
      relativePath: capture.relativePath,
      startOffset: capture.startOffset,
      startedAt: capture.startedAt,
    }
  }

  async finish(sessionInput: unknown): Promise<CaptureFinishResult> {
    const sessionId = requireNonEmptyString(sessionInput, 'sessionId', 256)
    const capture = this.sessions.get(sessionId)
    if (capture === undefined) {
      throw new BugKillerError('capture-not-active', '当前会话没有正在进行的日志采集。')
    }

    let currentStat
    try {
      currentStat = await stat(capture.filePath)
    } catch (error) {
      throw new BugKillerError('log-unavailable', '复现完成后无法读取日志文件。', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    if (!currentStat.isFile()) {
      throw new BugKillerError('log-not-file', '日志路径已不再是普通文件。')
    }
    assertSafeFileSize(currentStat.size)

    const replaced = currentStat.dev !== capture.device
      || currentStat.ino !== capture.inode
      || currentStat.birthtimeMs !== capture.birthtimeMs
    const truncated = currentStat.size < capture.startOffset
    const rotated = replaced || truncated
    const readStart = rotated ? 0 : capture.startOffset
    const readEnd = currentStat.size
    const totalNewBytes = Math.max(0, readEnd - readStart)
    const read = await readBoundedRange(
      capture.filePath,
      readStart,
      readEnd,
      this.config.maxCaptureBytes,
    )
    const logText = this.config.redactSecrets ? redactLogSecrets(read.text) : read.text
    const warnings: string[] = []
    if (rotated) warnings.push('检测到日志文件被截断或轮转，本次从当前文件开头读取。')
    if (read.omittedBytes > 0) {
      warnings.push(`新增日志超过采集上限，中间省略 ${read.omittedBytes} 字节，已保留开头和结尾。`)
    }

    const empty = totalNewBytes === 0
    if (!empty) this.sessions.delete(sessionId)

    return {
      sessionId,
      relativePath: capture.relativePath,
      startedAt: capture.startedAt,
      finishedAt: Date.now(),
      totalNewBytes,
      capturedBytes: read.capturedBytes,
      omittedBytes: read.omittedBytes,
      rotated,
      empty,
      logText,
      warnings,
    }
  }

  cancel(sessionInput: unknown): { cancelled: boolean } {
    const sessionId = requireNonEmptyString(sessionInput, 'sessionId', 256)
    return { cancelled: this.sessions.delete(sessionId) }
  }

  status(sessionInput: unknown): CaptureStatusResult {
    const sessionId = requireNonEmptyString(sessionInput, 'sessionId', 256)
    const capture = this.sessions.get(sessionId)
    if (capture === undefined) return { active: false, sessionId }
    return {
      active: true,
      sessionId,
      relativePath: capture.relativePath,
      startedAt: capture.startedAt,
      startOffset: capture.startOffset,
    }
  }

  private async walk(
    workspaceRoot: string,
    directory: string,
    depth: number,
    found: DiscoveredLog[],
  ): Promise<void> {
    if (depth > this.config.maxDiscoveryDepth || found.length >= DISCOVERY_LIMIT) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (found.length >= DISCOVERY_LIMIT) return
      const fullPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await this.walk(workspaceRoot, fullPath, depth + 1, found)
        }
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue
      try {
        const canonical = await realpath(fullPath)
        if (!isPathInside(workspaceRoot, canonical)) continue
        const fileStat = await stat(canonical)
        if (!fileStat.isFile()) continue
        found.push({
          relativePath: normalizeRelativePath(path.relative(workspaceRoot, canonical)),
          size: fileStat.size,
          modifiedAt: fileStat.mtimeMs,
        })
      } catch {
        // A file can disappear while discovery is running. Skip it and keep scanning.
      }
    }
  }
}

async function readBoundedRange(
  filePath: string,
  start: number,
  end: number,
  maxBytes: number,
): Promise<{ text: string; capturedBytes: number; omittedBytes: number }> {
  const total = Math.max(0, end - start)
  if (total === 0) return { text: '', capturedBytes: 0, omittedBytes: 0 }

  if (total <= maxBytes) {
    const buffer = await readExactRange(filePath, start, total)
    return { text: buffer.toString('utf8'), capturedBytes: buffer.length, omittedBytes: 0 }
  }

  const headBytes = Math.floor(maxBytes / 2)
  const tailBytes = maxBytes - headBytes
  const head = await readExactRange(filePath, start, headBytes)
  const tail = await readExactRange(filePath, end - tailBytes, tailBytes)
  const omittedBytes = total - head.length - tail.length
  const marker = `\n\n... [BUG KILLER 省略中间 ${omittedBytes} 字节日志] ...\n\n`
  return {
    text: `${head.toString('utf8')}${marker}${tail.toString('utf8')}`,
    capturedBytes: head.length + tail.length,
    omittedBytes,
  }
}

async function readExactRange(filePath: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let totalRead = 0
    while (totalRead < length) {
      const result = await handle.read(buffer, totalRead, length - totalRead, position + totalRead)
      if (result.bytesRead === 0) break
      totalRead += result.bytesRead
    }
    return buffer.subarray(0, totalRead)
  } finally {
    await handle.close()
  }
}

function assertSafeFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new BugKillerError('log-too-large', '日志文件大小超出当前运行时可安全处理的范围。')
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function clampInteger(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
