import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { DirectoryListing, ProjectDirectory } from './contracts.ts'
import { BugKillerError, isPathInside, requireNonEmptyString } from './security.ts'

const SKIPPED_DIRECTORIES = new Set([
  '.git', '.idea', '.pnpm-store', '.vscode',
  'build', 'classes', 'coverage', 'dist', 'node_modules', 'target',
])

export async function resolveProjectDirectory(rootInput: unknown, directoryInput: unknown): Promise<string> {
  const root = requireNonEmptyString(rootInput, 'rootCwd', 4096)
  const directory = requireNonEmptyString(directoryInput, 'directory', 4096)
  if (!path.isAbsolute(root) || !path.isAbsolute(directory)) {
    throw new BugKillerError('workspace-invalid', '项目目录必须使用绝对路径。')
  }

  let rootPath: string
  let directoryPath: string
  try {
    rootPath = await realpath(root)
    directoryPath = await realpath(directory)
    if (!(await stat(rootPath)).isDirectory() || !(await stat(directoryPath)).isDirectory()) {
      throw new Error('not a directory')
    }
  } catch (error) {
    throw new BugKillerError('workspace-unavailable', '无法访问选择的项目目录。', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  if (!isPathInside(rootPath, directoryPath)) {
    throw new BugKillerError('path-outside-workspace', '只能选择当前 DSH 工作目录及其子目录。')
  }
  return directoryPath
}

export async function listProjectDirectories(rootInput: unknown, directoryInput: unknown): Promise<DirectoryListing> {
  const rootPath = await resolveProjectDirectory(rootInput, rootInput)
  const currentPath = await resolveProjectDirectory(rootPath, directoryInput)
  const entries = await readdir(currentPath, { withFileTypes: true })
  const directories: ProjectDirectory[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue
    const candidate = path.join(currentPath, entry.name)
    try {
      const canonical = await realpath(candidate)
      if (!isPathInside(rootPath, canonical)) continue
      directories.push({ name: entry.name, path: canonical })
    } catch {
      // A directory can disappear while the picker is open. Skip it.
    }
  }

  directories.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
  return {
    rootPath,
    currentPath,
    ...(currentPath === rootPath ? {} : { parentPath: path.dirname(currentPath) }),
    directories,
  }
}
