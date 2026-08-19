import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listProjectDirectories, resolveProjectDirectory } from '../src/project-directory.ts'

const TEMP_PREFIX = '.tmp-bug-killer-projects-'

describe('project directory boundary', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(process.cwd(), TEMP_PREFIX))
    await mkdir(path.join(workspace, 'api', 'src'), { recursive: true })
    await mkdir(path.join(workspace, 'web'), { recursive: true })
    await mkdir(path.join(workspace, 'node_modules', 'ignored'), { recursive: true })
  })

  afterEach(async () => {
    if (workspace !== '' && path.basename(workspace).startsWith(TEMP_PREFIX)) {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('lists selectable child projects and skips generated directories', async () => {
    const listing = await listProjectDirectories(workspace, workspace)
    expect(listing.currentPath).toBe(listing.rootPath)
    expect(listing.parentPath).toBeUndefined()
    expect(listing.directories.map(directory => directory.name)).toEqual(['api', 'web'])

    const nested = await listProjectDirectories(workspace, path.join(workspace, 'api'))
    expect(nested.parentPath).toBe(listing.rootPath)
    expect(nested.directories.map(directory => directory.name)).toEqual(['src'])
  })

  it('rejects a selected directory outside the DSH working directory', async () => {
    const outside = await mkdtemp(path.join(process.cwd(), '.tmp-bug-killer-outside-project-'))
    try {
      await expect(resolveProjectDirectory(workspace, outside))
        .rejects.toMatchObject({ code: 'path-outside-workspace' })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
