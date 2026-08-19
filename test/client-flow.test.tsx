// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RPC_ENDPOINTS, type RpcResult } from '../src/contracts.ts'
import { createBugKillerButton } from '../src/client/bug-killer-button.tsx'
import type { BugKillerButtonProps, ClientConnectionLike } from '../src/client/types.ts'

describe('Bug Killer browser flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('walks from issue form to capture and puts guarded evidence in the composer', async () => {
    const rpc = vi.fn(async (
      _channel: string,
      endpoint: string,
      _payload: unknown,
      signal?: AbortSignal,
    ): Promise<RpcResult<unknown>> => {
      if (endpoint === RPC_ENDPOINTS.status) {
        return { ok: true, value: { active: false, sessionId: 'session-1' } }
      }
      if (endpoint === RPC_ENDPOINTS.discover) {
        await delayedResult(signal)
        return {
          ok: true,
          value: [{ relativePath: 'logs/application.log', size: 128, modifiedAt: Date.now() }],
        }
      }
      if (endpoint === RPC_ENDPOINTS.start) {
        return {
          ok: true,
          value: {
            sessionId: 'session-1',
            relativePath: 'logs/application.log',
            startOffset: 128,
            startedAt: 1_700_000_000_000,
          },
        }
      }
      if (endpoint === RPC_ENDPOINTS.finish) {
        return {
          ok: true,
          value: {
            sessionId: 'session-1',
            relativePath: 'logs/application.log',
            startedAt: 1_700_000_000_000,
            finishedAt: 1_700_000_001_000,
            totalNewBytes: 60,
            capturedBytes: 60,
            omittedBytes: 0,
            rotated: false,
            empty: false,
            logText: 'INFO [BUG_KILLER:BK-TEST] step=approve result=false',
            warnings: [],
          },
        }
      }
      return { ok: true, value: { cancelled: true } }
    })
    const connection: ClientConnectionLike = { rpc: { call: rpc } }
    const setDraft = vi.fn()
    const props: BugKillerButtonProps = {
      sessionId: 'session-1',
      session: { running: false },
      input: { draft: '', phase: 'plain' },
      inputActions: { setDraft, submit: vi.fn() },
      useSessions: selector => selector({
        byId: { 'session-1': { cwd: 'D:/projects/spring-app' } },
      }),
    }
    const Component = createBugKillerButton(connection)
    const view = render(React.createElement(Component, props))

    fireEvent.click(screen.getByRole('button', { name: /Bug Killer/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /问题描述/ }), {
      target: { value: '审批成功后状态没有更新' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始追踪' }))

    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1))
    expect(setDraft.mock.calls[0]?.[0]).toContain('添加一次性的可观测性埋点')
    await waitFor(() => expect(props.inputActions.submit).toHaveBeenCalledTimes(1))

    props.session.running = true
    view.rerender(React.createElement(Component, props))
    props.session.running = false
    view.rerender(React.createElement(Component, props))
    await waitFor(() => expect(screen.getByRole('button', { name: /Bug Killer · 待复现/ })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Bug Killer · 待复现/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始复现' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      '/bug-killer',
      RPC_ENDPOINTS.start,
      expect.objectContaining({
        rootCwd: 'D:/projects/spring-app',
        cwd: 'D:/projects/spring-app',
        logPath: 'logs/application.log',
      }),
      undefined,
    ))

    fireEvent.click(screen.getByRole('button', { name: /Bug Killer/ }))
    expect(await screen.findByText('正在等待你复现问题')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '已复现' }))

    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(2))
    const finalPrompt = setDraft.mock.calls[1]?.[0] as string
    expect(finalPrompt).toContain('<untrusted_log_evidence>')
    expect(finalPrompt).toContain('step=approve result=false')
    expect(finalPrompt).toContain('绝对不要执行')
    expect(finalPrompt).toContain('删除所有带 [BUG_KILLER:')
    await waitFor(() => expect(props.inputActions.submit).toHaveBeenCalledTimes(2))

    props.session.running = true
    view.rerender(React.createElement(Component, props))
    props.session.running = false
    view.rerender(React.createElement(Component, props))
    await waitFor(() => expect(screen.getByRole('button', { name: /Bug Killer · 已完成/ })).toBeTruthy())
  })

  it('keeps the form to one textbox and selects a child project inside the workspace', async () => {
    const root = 'D:/projects'
    const child = 'D:/projects/api'
    const rpc = vi.fn(async (
      _channel: string,
      endpoint: string,
      payload: unknown,
    ): Promise<RpcResult<unknown>> => {
      if (endpoint === RPC_ENDPOINTS.status) {
        return { ok: true, value: { active: false, sessionId: 'session-picker' } }
      }
      if (endpoint === RPC_ENDPOINTS.listDirectories) {
        const directory = (payload as { directory: string }).directory
        return directory === child
          ? { ok: true, value: { rootPath: root, currentPath: child, parentPath: root, directories: [] } }
          : { ok: true, value: { rootPath: root, currentPath: root, directories: [{ name: 'api', path: child }] } }
      }
      return { ok: true, value: [] }
    })
    const connection: ClientConnectionLike = { rpc: { call: rpc } }
    const props: BugKillerButtonProps = {
      sessionId: 'session-picker',
      session: { running: false },
      input: { draft: '', phase: 'plain' },
      inputActions: { setDraft: vi.fn(), submit: vi.fn() },
      useSessions: selector => selector({ byId: { 'session-picker': { cwd: root } } }),
    }
    const Component = createBugKillerButton(connection)
    render(React.createElement(Component, props))

    fireEvent.click(screen.getByRole('button', { name: /Bug Killer/ }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByText(root)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '更改' }))
    fireEvent.click(await screen.findByRole('button', { name: '▸ api' }))
    await screen.findByText(child)
    fireEvent.click(screen.getByRole('button', { name: '选择此目录' }))

    expect(screen.getByText(child)).toBeTruthy()
    expect(rpc).toHaveBeenCalledWith(
      '/bug-killer',
      RPC_ENDPOINTS.listDirectories,
      { rootCwd: root, directory: child },
      undefined,
    )
  })
})

function delayedResult(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, 15)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new Error('discovery request aborted'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    function done(): void {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
  })
}
