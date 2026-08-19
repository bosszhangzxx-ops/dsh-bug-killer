import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export class BugKillerError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'BugKillerError'
    this.code = code
    this.details = details
  }
}

export function requireNonEmptyString(value: unknown, field: string, maxLength = 32_768): string {
  if (typeof value !== 'string') {
    throw new BugKillerError('invalid-request', `${field} 必须是字符串。`)
  }
  const normalized = value.trim()
  if (normalized === '') {
    throw new BugKillerError('invalid-request', `${field} 不能为空。`)
  }
  if (normalized.length > maxLength) {
    throw new BugKillerError('invalid-request', `${field} 长度不能超过 ${maxLength} 个字符。`)
  }
  return normalized
}

export async function resolveWorkspaceFile(cwdInput: unknown, fileInput: unknown): Promise<{
  workspaceRoot: string
  filePath: string
  relativePath: string
}> {
  const cwd = requireNonEmptyString(cwdInput, 'cwd', 4096)
  const requestedFile = requireNonEmptyString(fileInput, 'logPath', 4096)
  if (!path.isAbsolute(cwd)) {
    throw new BugKillerError('workspace-invalid', '当前 DSH 工作区路径不是绝对路径。')
  }

  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(cwd)
    const workspaceStat = await stat(workspaceRoot)
    if (!workspaceStat.isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new BugKillerError('workspace-unavailable', '无法访问当前 DSH 工作区。', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  const candidate = path.isAbsolute(requestedFile)
    ? path.normalize(requestedFile)
    : path.resolve(workspaceRoot, requestedFile)

  let filePath: string
  try {
    filePath = await realpath(candidate)
  } catch (error) {
    throw new BugKillerError('log-not-found', `找不到日志文件：${requestedFile}`, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  if (!isPathInside(workspaceRoot, filePath)) {
    throw new BugKillerError('path-outside-workspace', '日志文件必须位于当前 DSH 工作区内。')
  }

  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) {
    throw new BugKillerError('log-not-file', '选择的日志路径不是普通文件。')
  }

  return {
    workspaceRoot,
    filePath,
    relativePath: normalizeRelativePath(path.relative(workspaceRoot, filePath)),
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/')
}

export function redactLogSecrets(input: string): string {
  let text = stripUnsafeControlCharacters(input)

  text = text.replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
  text = text.replace(
    /(\b(?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gim,
    '$1[REDACTED]',
  )
  text = text.replace(
    /(\b(?:password|passwd|pwd|secret|token|access_token|refresh_token|client_secret)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}&]+)/gim,
    '$1[REDACTED]',
  )
  text = text.replace(
    /([?&](?:password|passwd|pwd|secret|token|access_token|refresh_token|client_secret)=)[^&\s]*/gi,
    '$1[REDACTED]',
  )

  return text
}

function stripUnsafeControlCharacters(input: string): string {
  let result = ''
  for (const character of input) {
    const code = character.charCodeAt(0)
    const allowedWhitespace = code === 9 || code === 10 || code === 13
    if (allowedWhitespace || code >= 32) result += character
  }
  return result
}
