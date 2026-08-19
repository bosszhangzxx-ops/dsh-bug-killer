import React from 'react'
import {
  RPC_CHANNEL,
  RPC_ENDPOINTS,
  type CaptureFinishResult,
  type CaptureStartResult,
  type CaptureStatusResult,
  type DirectoryListing,
  type DiscoveredLog,
} from '../contracts.ts'
import {
  buildDiagnosisPrompt,
  buildInstrumentationPrompt,
  createTraceId,
  type BugDescription,
} from '../prompts.ts'
import type { BugKillerButtonProps, ClientConnectionLike } from './types.ts'

type Stage = 'setup' | 'instrumenting' | 'instrumented' | 'capturing' | 'fixing' | 'complete' | 'failed'

interface StoredState {
  issue: string
  projectPath: string
  logPath: string
  traceId: string
  stage: Stage
  failedTask?: 'instrumentation' | 'diagnosis'
  startedAt?: number
}

const EMPTY_STATE: StoredState = {
  issue: '',
  projectPath: '',
  logPath: '',
  traceId: '',
  stage: 'setup',
}

export function createBugKillerButton(connection: ClientConnectionLike) {
  return function BugKillerButton(props: BugKillerButtonProps): React.ReactElement {
    const h = React.createElement
    const cwd = props.useSessions(state => state.byId[props.sessionId]?.cwd ?? '')
    const [open, setOpen] = React.useState(false)
    const [stored, setStored] = React.useState<StoredState>(() => loadState(props.sessionId))
    const [directoryListing, setDirectoryListing] = React.useState<DirectoryListing>()
    const [directoryPickerOpen, setDirectoryPickerOpen] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const instrumentationRan = React.useRef(false)
    const diagnosisRan = React.useRef(false)

    React.useEffect(() => {
      if (cwd === '') return
      setStored((current) => current.projectPath === '' ? { ...current, projectPath: cwd } : current)
    }, [cwd])

    React.useEffect(() => {
      saveState(props.sessionId, stored)
    }, [props.sessionId, stored])

    React.useEffect(() => {
      if (stored.stage === 'instrumenting') {
        if (props.session.running) instrumentationRan.current = true
        if (!props.session.running && instrumentationRan.current) {
          instrumentationRan.current = false
          setStored(current => current.stage === 'instrumenting'
            ? props.session.promptError == null
              ? { ...current, stage: 'instrumented' }
              : { ...current, stage: 'failed', failedTask: 'instrumentation' }
            : current)
        }
      }
      if (stored.stage === 'fixing') {
        if (props.session.running) diagnosisRan.current = true
        if (!props.session.running && diagnosisRan.current) {
          diagnosisRan.current = false
          setStored(current => current.stage === 'fixing'
            ? props.session.promptError == null
              ? { ...current, stage: 'complete' }
              : { ...current, stage: 'failed', failedTask: 'diagnosis' }
            : current)
        }
      }
    }, [props.session.promptError, props.session.running, stored.stage])

    React.useEffect(() => {
      if (!open) return
      const listener = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !busy) setOpen(false)
      }
      document.addEventListener('keydown', listener)
      return () => document.removeEventListener('keydown', listener)
    }, [open, busy])

    React.useEffect(() => {
      const controller = new AbortController()
      void callRpc<CaptureStatusResult>(
        connection,
        RPC_ENDPOINTS.status,
        { sessionId: props.sessionId },
        controller.signal,
      ).then((status) => {
        if (!status.active) {
          setStored((current) => {
            if (current.stage !== 'capturing') return current
            const next: StoredState = { ...current, stage: 'instrumented' }
            delete next.startedAt
            return next
          })
          return
        }
        setStored(current => ({
          ...current,
          stage: 'capturing',
          logPath: status.relativePath ?? current.logPath,
          ...(status.startedAt === undefined ? {} : { startedAt: status.startedAt }),
        }))
      }).catch(() => {
        // The button remains usable; a real error is shown when the user starts an action.
      })
      return () => controller.abort()
    }, [connection, props.sessionId])

    const patchStored = (patch: Partial<StoredState>): void => {
      setStored(current => ({ ...current, ...patch }))
      setError('')
    }

    const startTracking = async (): Promise<void> => {
      const validation = validate(stored, cwd)
      if (validation !== '') {
        setError(validation)
        return
      }
      if (props.session.running) {
        setError('当前 DSH 会话正在执行其他任务，请等待它完成后再开始追踪。')
        return
      }
      if (!composerIsEmpty(props)) {
        setError('DSH 输入框里已有内容。请先发送或清空，Bug Killer 不会覆盖它。')
        return
      }
      setBusy(true)
      setError('')
      try {
        const found = await callRpc<DiscoveredLog[]>(connection, RPC_ENDPOINTS.discover, {
          rootCwd: cwd,
          cwd: stored.projectPath,
        })
        const traceId = createTraceId()
        const logPath = found[0]?.relativePath ?? 'logs/bug-killer.log'
        const description: BugDescription = {
          issue: stored.issue,
          projectPath: stored.projectPath,
          logPath,
          traceId,
        }
        instrumentationRan.current = false
        setStored(current => {
          const next: StoredState = { ...current, traceId, logPath, stage: 'instrumenting' }
          delete next.failedTask
          return next
        })
        setOpen(false)
        submitPrompt(props, buildInstrumentationPrompt(description))
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const startReproduction = async (): Promise<void> => {
      if (!composerIsEmpty(props)) {
        setError('DSH 输入框里已有内容，请先处理后再开始复现。')
        return
      }
      const validation = validate(stored, cwd)
      if (validation !== '') {
        setError(validation)
        return
      }
      setBusy(true)
      setError('')
      try {
        const found = await callRpc<DiscoveredLog[]>(connection, RPC_ENDPOINTS.discover, {
          rootCwd: cwd,
          cwd: stored.projectPath,
        })
        const logPath = found.some(log => log.relativePath === stored.logPath)
          ? stored.logPath
          : found[0]?.relativePath ?? stored.logPath
        const result = await callRpc<CaptureStartResult>(connection, RPC_ENDPOINTS.start, {
          sessionId: props.sessionId,
          rootCwd: cwd,
          cwd: stored.projectPath,
          logPath,
        })
        setStored(current => ({
          ...current,
          stage: 'capturing',
          logPath: result.relativePath,
          startedAt: result.startedAt,
        }))
        setOpen(false)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const finishReproduction = async (): Promise<void> => {
      if (!composerIsEmpty(props)) {
        setError('DSH 输入框里已有内容。请先处理后再提交日志证据。')
        return
      }
      if (props.session.running) {
        setError('当前 DSH 会话正在执行其他任务，请等待它完成。')
        return
      }
      setBusy(true)
      setError('')
      try {
        const result = await callRpc<CaptureFinishResult>(connection, RPC_ENDPOINTS.finish, {
          sessionId: props.sessionId,
        })
        if (result.empty) {
          setError('没有捕获到新增日志。请确认项目正在写入该文件，然后继续复现并再次点击“已复现”。')
          return
        }
        const description: BugDescription = {
          issue: stored.issue,
          projectPath: stored.projectPath,
          logPath: stored.logPath,
          traceId: stored.traceId,
        }
        diagnosisRan.current = false
        setStored(current => {
          const next: StoredState = { ...current, stage: 'fixing' }
          delete next.failedTask
          return next
        })
        setOpen(false)
        submitPrompt(props, buildDiagnosisPrompt(description, result))
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const cancelCapture = async (): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        await callRpc(connection, RPC_ENDPOINTS.cancel, { sessionId: props.sessionId })
        setStored((current) => {
          const next: StoredState = { ...current, stage: 'instrumented' }
          delete next.startedAt
          return next
        })
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const reset = async (): Promise<void> => {
      if (stored.stage === 'capturing') {
        try {
          await callRpc(connection, RPC_ENDPOINTS.cancel, { sessionId: props.sessionId })
        } catch (reason) {
          setError(messageOf(reason))
          return
        }
      }
      const next = { ...EMPTY_STATE, projectPath: stored.projectPath }
      setStored(next)
      setError('')
      clearState(props.sessionId)
    }

    const browseDirectory = async (directory: string): Promise<void> => {
      if (cwd === '') return
      setBusy(true)
      setError('')
      try {
        const listing = await callRpc<DirectoryListing>(connection, RPC_ENDPOINTS.listDirectories, {
          rootCwd: cwd,
          directory,
        })
        setDirectoryListing(listing)
        setDirectoryPickerOpen(true)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const chooseDirectory = (): void => {
      if (directoryListing === undefined) return
      patchStored({ projectPath: directoryListing.currentPath, logPath: '' })
      setDirectoryPickerOpen(false)
    }

    const statusLabel = labelFor(stored.stage)
    const trigger = h(
      'button',
      {
        type: 'button',
        className: 'dbk-trigger',
        disabled: props.input.phase !== 'plain',
        title: '自动埋点、采集日志并交给 DSH 修复',
        onClick: () => {
          setError('')
          setOpen(true)
        },
      },
      h('span', { className: `dbk-dot${stored.stage === 'capturing' ? ' dbk-dot-live' : ''}` }),
      h('span', null, `Bug Killer${statusLabel === '' ? '' : ` · ${statusLabel}`}`),
    )

    if (!open) return trigger

    const modal = h(
      'div',
      {
        className: 'dbk-backdrop',
        onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
          if (event.target === event.currentTarget && !busy) setOpen(false)
        },
      },
      h(
        'section',
        {
          className: 'dbk-dialog',
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'dbk-dialog-title',
        },
        h(
          'header',
          { className: 'dbk-header' },
          h(
            'div',
            { className: 'dbk-header-copy' },
            h('h2', { id: 'dbk-dialog-title', className: 'dbk-title' }, 'Bug Killer'),
            h('p', { className: 'dbk-subtitle' }, '给问题加埋点 → 记录日志起点 → 复现 → 把证据交回 DSH'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbk-icon-button',
              'aria-label': '关闭',
              disabled: busy,
              onClick: () => setOpen(false),
            },
            '×',
          ),
        ),
        h(
          'div',
          { className: 'dbk-body' },
          error === '' ? null : h('p', { className: 'dbk-error', role: 'alert' }, error),
          renderBody(h, stored, patchStored, {
            cwd,
            running: props.session.running,
            directoryListing,
            directoryPickerOpen,
            browseDirectory,
            chooseDirectory,
            closeDirectoryPicker: () => setDirectoryPickerOpen(false),
          }),
        ),
        renderFooter(h, stored.stage, busy, {
          startTracking,
          startReproduction,
          finishReproduction,
          cancelCapture,
          reset,
          edit: () => patchStored({ stage: 'setup', traceId: '', logPath: '' }),
          close: () => setOpen(false),
        }),
      ),
    )

    return h(React.Fragment, null, trigger, modal)
  }
}

function renderBody(
  h: typeof React.createElement,
  state: StoredState,
  patch: (patch: Partial<StoredState>) => void,
  options: {
    cwd: string
    running: boolean
    directoryListing: DirectoryListing | undefined
    directoryPickerOpen: boolean
    browseDirectory(directory: string): Promise<void>
    chooseDirectory(): void
    closeDirectoryPicker(): void
  },
): React.ReactNode {
  if (state.stage === 'capturing') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), '正在等待你复现问题'),
      h('p', null, '插件已经记录日志文件的字节位置。现在去前台完整复现一次业务问题，回来后点击“已复现”。'),
      h(
        'div',
        { className: 'dbk-meta' },
        h('span', { className: 'dbk-meta-key' }, '日志文件'),
        h('span', { className: 'dbk-meta-value' }, state.logPath),
        h('span', { className: 'dbk-meta-key' }, '开始时间'),
        h('span', { className: 'dbk-meta-value' }, state.startedAt === undefined ? '刚刚' : new Date(state.startedAt).toLocaleString()),
      ),
    )
  }

  if (state.stage === 'instrumenting') {
    return h(
      'div',
      { className: 'dbk-grid' },
      h(
        'div',
        { className: 'dbk-card' },
        h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), options.running ? 'DSH 正在分析项目并添加埋点' : '正在把埋点任务交给 DSH'),
        h('p', null, 'DSH 会先识别项目类型和日志方式，再定位相关功能的完整方法链并加入临时追踪日志。任务已经自动发送。'),
      ),
      summaryCard(h, state),
    )
  }

  if (state.stage === 'instrumented') {
    return h(
      'div',
      { className: 'dbk-grid' },
      h(
        'div',
        { className: 'dbk-card' },
        h('h3', { className: 'dbk-card-title' }, '埋点已经完成'),
        h('p', null, '按照 DSH 给出的方式启动或重启项目。确认日志文件开始产生内容后，点击“开始复现”。'),
      ),
      summaryCard(h, state),
    )
  }

  if (state.stage === 'fixing') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), options.running ? 'DSH 正在根据日志定位并修复' : '正在提交日志证据'),
      h('p', null, '修复任务已经自动发送。完成修复和检查后，DSH 会自动删除本次临时埋点与临时日志配置。'),
    )
  }

  if (state.stage === 'complete') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, '本次修复任务已完成'),
      h('p', null, 'DSH 已结束修复流程，并按任务要求检查和清理本次追踪标识对应的临时埋点。你可以查看会话中的修复结果。'),
      summaryCard(h, state),
    )
  }

  if (state.stage === 'failed') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, state.failedTask === 'diagnosis' ? '修复任务未正常完成' : '埋点任务未正常完成'),
      h('p', null, state.failedTask === 'diagnosis'
        ? '请查看 DSH 会话里的错误。任务中断时临时埋点可能尚未清理，接受代码前请搜索本次追踪标识。'
        : '请查看 DSH 会话里的错误。本次追踪没有进入复现阶段。'),
      summaryCard(h, state),
    )
  }

  return h(
    'div',
    { className: 'dbk-grid' },
    field(h, '问题描述', true, h('textarea', {
      className: 'dbk-textarea',
      value: state.issue,
      maxLength: 8_000,
      placeholder: '例如：审核通过后，学生状态仍然显示“待审核”，刷新页面也不变。',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => patch({ issue: event.target.value }),
    })),
    h(
      'div',
      { className: 'dbk-field' },
      h('span', { className: 'dbk-label' }, '项目文件夹'),
      h(
        'div',
        { className: 'dbk-project-row' },
        h('span', { className: 'dbk-project-path', title: state.projectPath }, state.projectPath || options.cwd || '当前会话没有工作目录'),
        h('button', {
          type: 'button',
          className: 'dbk-link-button',
          disabled: options.cwd === '',
          onClick: () => { void options.browseDirectory(state.projectPath || options.cwd) },
        }, '更改'),
      ),
      h('p', { className: 'dbk-help' }, '只能选择当前 DSH 工作目录本身或它下面的子目录。'),
    ),
    options.directoryPickerOpen && options.directoryListing !== undefined
      ? directoryPicker(h, options.directoryListing, options)
      : null,
  )
}

function directoryPicker(
  h: typeof React.createElement,
  listing: DirectoryListing,
  actions: {
    browseDirectory(directory: string): Promise<void>
    chooseDirectory(): void
    closeDirectoryPicker(): void
  },
): React.ReactNode {
  return h(
    'div',
    { className: 'dbk-directory-picker' },
    h('p', { className: 'dbk-directory-current', title: listing.currentPath }, listing.currentPath),
    h(
      'div',
      { className: 'dbk-directory-list' },
      listing.parentPath === undefined ? null : h('button', {
        type: 'button',
        className: 'dbk-directory-entry',
        onClick: () => { void actions.browseDirectory(listing.parentPath ?? listing.rootPath) },
      }, '↰ 上一级'),
      ...listing.directories.map(directory => h('button', {
        key: directory.path,
        type: 'button',
        className: 'dbk-directory-entry',
        onClick: () => { void actions.browseDirectory(directory.path) },
      }, `▸ ${directory.name}`)),
      listing.directories.length === 0
        ? h('p', { className: 'dbk-help' }, '这个目录下没有可选的子目录。')
        : null,
    ),
    h(
      'div',
      { className: 'dbk-directory-actions' },
      h('button', { type: 'button', className: 'dbk-button', onClick: actions.closeDirectoryPicker }, '取消'),
      h('button', { type: 'button', className: 'dbk-button dbk-button-primary', onClick: actions.chooseDirectory }, '选择此目录'),
    ),
  )
}

function renderFooter(
  h: typeof React.createElement,
  stage: Stage,
  busy: boolean,
  actions: {
    startTracking(): Promise<void>
    startReproduction(): Promise<void>
    finishReproduction(): Promise<void>
    cancelCapture(): Promise<void>
    reset(): Promise<void>
    edit(): void
    close(): void
  },
): React.ReactNode {
  const button = (
    label: string,
    onClick: () => void,
    variant = '',
    disabled = busy,
  ): React.ReactElement => h('button', {
    type: 'button',
    className: `dbk-button${variant === '' ? '' : ` dbk-button-${variant}`}`,
    disabled,
    onClick,
  }, label)

  let right: React.ReactElement[]
  if (stage === 'setup') {
    right = [button('取消', actions.close), button(busy ? '正在准备…' : '开始追踪', () => { void actions.startTracking() }, 'primary')]
  } else if (stage === 'instrumenting') {
    right = [button('关闭', actions.close)]
  } else if (stage === 'instrumented') {
    right = [button('修改问题', actions.edit), button(busy ? '正在检查日志…' : '开始复现', () => { void actions.startReproduction() }, 'primary')]
  } else if (stage === 'capturing') {
    right = [
      button('取消追踪', () => { void actions.cancelCapture() }, 'danger'),
      button(busy ? '正在抓取…' : '已复现', () => { void actions.finishReproduction() }, 'primary'),
    ]
  } else if (stage === 'fixing') {
    right = [button('关闭', actions.close)]
  } else if (stage === 'failed') {
    right = [button('关闭', actions.close), button('追踪新问题', () => { void actions.reset() }, 'primary')]
  } else {
    right = [button('关闭', actions.close), button('追踪新问题', () => { void actions.reset() }, 'primary')]
  }

  return h(
    'footer',
    { className: 'dbk-footer' },
    h('span', { className: 'dbk-help' }, stage === 'setup' ? '开始后，埋点和修复任务将自动发送给 DSH。' : 'Bug Killer 只读取所选项目内的增量日志。'),
    h('div', { className: 'dbk-actions' }, ...right),
  )
}

function summaryCard(h: typeof React.createElement, state: StoredState): React.ReactNode {
  return h(
    'div',
    { className: 'dbk-card' },
    h('h3', { className: 'dbk-card-title' }, state.issue),
    h(
      'div',
      { className: 'dbk-meta' },
      h('span', { className: 'dbk-meta-key' }, '日志'),
      h('span', { className: 'dbk-meta-value' }, state.logPath),
      h('span', { className: 'dbk-meta-key' }, '项目'),
      h('span', { className: 'dbk-meta-value' }, state.projectPath || '不可用'),
      h('span', { className: 'dbk-meta-key' }, '追踪标识'),
      h('span', { className: 'dbk-meta-value' }, state.traceId || '尚未生成'),
    ),
  )
}

function field(
  h: typeof React.createElement,
  label: string,
  required: boolean,
  control: React.ReactNode,
): React.ReactNode {
  return h(
    'label',
    { className: 'dbk-field' },
    h(
      'span',
      { className: 'dbk-label' },
      label,
      required ? h('span', { className: 'dbk-required' }, '*') : null,
    ),
    control,
  )
}

async function callRpc<T>(
  connection: ClientConnectionLike,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const result = await connection.rpc.call(RPC_CHANNEL, endpoint, payload, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

function validate(state: StoredState, cwd: string): string {
  if (state.issue.trim() === '') return '请填写遇到的问题。'
  if (cwd === '') return '当前 DSH 会话没有工作区路径，无法把日志读取限制在项目内。'
  if (state.projectPath.trim() === '') return '请选择要追踪的项目文件夹。'
  return ''
}

function composerIsEmpty(props: BugKillerButtonProps): boolean {
  return props.input.phase === 'plain' && props.input.draft.trim() === ''
}

function labelFor(stage: Stage): string {
  if (stage === 'instrumenting') return '埋点中'
  if (stage === 'instrumented') return '待复现'
  if (stage === 'capturing') return '追踪中'
  if (stage === 'fixing') return '修复中'
  if (stage === 'complete') return '已完成'
  if (stage === 'failed') return '执行异常'
  return ''
}

function storageKey(sessionId: string): string {
  return `dsh-bug-killer:v1:${sessionId}`
}

function loadState(sessionId: string): StoredState {
  if (typeof localStorage === 'undefined') return EMPTY_STATE
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (raw === null) return EMPTY_STATE
    const value = JSON.parse(raw) as unknown
    if (!isStoredState(value)) return EMPTY_STATE
    return value
  } catch {
    return EMPTY_STATE
  }
}

function saveState(sessionId: string, state: StoredState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(state))
  } catch {
    // Persistence is a convenience; storage quotas must not break log capture.
  }
}

function clearState(sessionId: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(storageKey(sessionId))
  } catch {
    // Ignore browser storage failures.
  }
}

function isStoredState(value: unknown): value is StoredState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.issue === 'string'
    && typeof candidate.projectPath === 'string'
    && typeof candidate.logPath === 'string'
    && typeof candidate.traceId === 'string'
    && (candidate.stage === 'setup'
      || candidate.stage === 'instrumenting'
      || candidate.stage === 'instrumented'
      || candidate.stage === 'capturing'
      || candidate.stage === 'fixing'
      || candidate.stage === 'complete'
      || candidate.stage === 'failed')
    && (candidate.failedTask === undefined
      || candidate.failedTask === 'instrumentation'
      || candidate.failedTask === 'diagnosis')
    && (candidate.startedAt === undefined || typeof candidate.startedAt === 'number')
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function submitPrompt(props: BugKillerButtonProps, prompt: string): void {
  props.inputActions.setDraft(prompt)
  queueMicrotask(() => props.inputActions.submit())
}
