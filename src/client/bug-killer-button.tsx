import React from 'react'
import {
  RPC_CHANNEL,
  RPC_ENDPOINTS,
  type CaptureFinishResult,
  type CaptureStartResult,
  type CaptureStatusResult,
  type DiscoveredLog,
} from '../contracts.ts'
import {
  buildDiagnosisPrompt,
  buildInstrumentationPrompt,
  createTraceId,
  type BugDescription,
} from '../prompts.ts'
import type { BugKillerButtonProps, ClientConnectionLike } from './types.ts'

type Stage = 'setup' | 'instrumenting' | 'capturing' | 'ready'

interface StoredState {
  issue: string
  expected: string
  actual: string
  logPath: string
  traceId: string
  stage: Stage
  startedAt?: number
}

const EMPTY_STATE: StoredState = {
  issue: '',
  expected: '',
  actual: '',
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
    const [logs, setLogs] = React.useState<DiscoveredLog[]>([])
    const [discovering, setDiscovering] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')

    React.useEffect(() => {
      saveState(props.sessionId, stored)
    }, [props.sessionId, stored])

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
            const next: StoredState = { ...current, stage: 'instrumenting' }
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

    React.useEffect(() => {
      if (!open || cwd === '' || logs.length > 0 || stored.stage === 'capturing') return
      const controller = new AbortController()
      setDiscovering(true)
      void callRpc<DiscoveredLog[]>(connection, RPC_ENDPOINTS.discover, { cwd }, controller.signal)
        .then((found) => {
          setLogs(found)
          if (stored.logPath === '' && found[0] !== undefined) {
            setStored(current => ({ ...current, logPath: found[0]?.relativePath ?? '' }))
          }
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(messageOf(reason))
        })
        .finally(() => {
          if (!controller.signal.aborted) setDiscovering(false)
        })
      return () => controller.abort()
    }, [connection, cwd, logs.length, open, stored.logPath, stored.stage])

    const patchStored = (patch: Partial<StoredState>): void => {
      setStored(current => ({ ...current, ...patch }))
      setError('')
    }

    const startTracking = (): void => {
      const validation = validate(stored, cwd)
      if (validation !== '') {
        setError(validation)
        return
      }
      if (!composerIsEmpty(props)) {
        setError('DSH 输入框里已有内容。请先发送或清空，Bug Killer 不会覆盖它。')
        return
      }
      const traceId = stored.traceId || createTraceId()
      const description: BugDescription = { ...stored, traceId }
      props.inputActions.setDraft(buildInstrumentationPrompt(description))
      setStored(current => ({ ...current, traceId, stage: 'instrumenting' }))
      setOpen(false)
    }

    const regenerateTrackingPrompt = (): void => {
      if (!composerIsEmpty(props)) {
        setError('DSH 输入框里已有内容，无法放入新的埋点提示词。')
        return
      }
      const traceId = stored.traceId || createTraceId()
      props.inputActions.setDraft(buildInstrumentationPrompt({ ...stored, traceId }))
      setStored(current => ({ ...current, traceId }))
      setOpen(false)
    }

    const startReproduction = async (): Promise<void> => {
      if (!composerIsEmpty(props)) {
        setError('请先把输入框中的埋点提示词发送给 DSH，并等待它完成埋点。')
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
        const result = await callRpc<CaptureStartResult>(connection, RPC_ENDPOINTS.start, {
          sessionId: props.sessionId,
          cwd,
          logPath: stored.logPath,
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
        setError('DSH 输入框里已有内容。请先发送或清空，最终排障提示词不会覆盖现有草稿。')
        return
      }
      setBusy(true)
      setError('')
      try {
        const result = await callRpc<CaptureFinishResult>(connection, RPC_ENDPOINTS.finish, {
          sessionId: props.sessionId,
        })
        if (result.empty) {
          setError('没有捕获到新增日志。请确认 Spring 服务正在写入该文件，然后继续复现并再次点击“已复现”。')
          return
        }
        const description: BugDescription = {
          issue: stored.issue,
          expected: stored.expected,
          actual: stored.actual,
          logPath: stored.logPath,
          traceId: stored.traceId,
        }
        props.inputActions.setDraft(buildDiagnosisPrompt(description, result))
        setStored(current => ({ ...current, stage: 'ready' }))
        setOpen(false)
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
          const next: StoredState = { ...current, stage: 'instrumenting' }
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
      const next = { ...EMPTY_STATE, logPath: stored.logPath }
      setStored(next)
      setError('')
      clearState(props.sessionId)
    }

    const statusLabel = labelFor(stored.stage)
    const trigger = h(
      'button',
      {
        type: 'button',
        className: 'dbk-trigger',
        disabled: props.input.phase !== 'plain',
        title: '复现问题并采集 Spring 日志',
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
          renderBody(h, stored, patchStored, logs, discovering, cwd),
        ),
        renderFooter(h, stored.stage, busy, {
          startTracking,
          regenerateTrackingPrompt,
          startReproduction,
          finishReproduction,
          cancelCapture,
          reset,
          edit: () => patchStored({ stage: 'setup' }),
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
  logs: DiscoveredLog[],
  discovering: boolean,
  cwd: string,
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
        h('h3', { className: 'dbk-card-title' }, '埋点提示词已放入输入框'),
        h('p', null, '请先发送给 DSH，等待它完成临时日志埋点，然后重启本地 Spring 服务。确认日志文件已经产生后，再点击“开始复现”。'),
      ),
      summaryCard(h, state, cwd),
    )
  }

  if (state.stage === 'ready') {
    return h(
      'div',
      { className: 'dbk-grid' },
      h(
        'div',
        { className: 'dbk-card' },
        h('h3', { className: 'dbk-card-title' }, '日志证据已放入输入框'),
        h('p', null, '插件没有自动发送。请检查输入框中的问题描述、日志和安全约束，确认后手动发送给 DSH。'),
      ),
      summaryCard(h, state, cwd),
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
    field(h, '预期结果', false, h('textarea', {
      className: 'dbk-textarea',
      value: state.expected,
      maxLength: 4_000,
      placeholder: '例如：审核通过后状态应立即变为“已通过”。',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => patch({ expected: event.target.value }),
    })),
    field(h, '实际结果', false, h('textarea', {
      className: 'dbk-textarea',
      value: state.actual,
      maxLength: 4_000,
      placeholder: '例如：接口返回成功，但列表状态未更新。',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => patch({ actual: event.target.value }),
    })),
    field(
      h,
      'Spring 日志文件',
      true,
      h(
        React.Fragment,
        null,
        h('input', {
          className: 'dbk-input',
          value: state.logPath,
          maxLength: 4_096,
          placeholder: 'logs/application.log',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ logPath: event.target.value }),
        }),
        h('p', { className: 'dbk-help' }, cwd === ''
          ? '当前会话没有工作区路径，无法安全读取日志。'
          : `只允许读取当前工作区内的文件：${cwd}`),
        discovering ? h('p', { className: 'dbk-help' }, '正在查找 .log 文件…') : null,
        logs.length === 0
          ? null
          : h(
              'div',
              { className: 'dbk-suggestions', 'aria-label': '发现的日志文件' },
              ...logs.slice(0, 6).map(log => h(
                'button',
                {
                  key: log.relativePath,
                  type: 'button',
                  className: 'dbk-suggestion',
                  title: `${log.relativePath} · ${formatBytes(log.size)}`,
                  onClick: () => patch({ logPath: log.relativePath }),
                },
                log.relativePath,
              )),
            ),
      ),
    ),
  )
}

function renderFooter(
  h: typeof React.createElement,
  stage: Stage,
  busy: boolean,
  actions: {
    startTracking(): void
    regenerateTrackingPrompt(): void
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
    right = [button('取消', actions.close), button('开始追踪', actions.startTracking, 'primary')]
  } else if (stage === 'instrumenting') {
    right = [
      button('修改问题', actions.edit),
      button('重新生成埋点提示词', actions.regenerateTrackingPrompt),
      button(busy ? '正在检查日志…' : '开始复现', () => { void actions.startReproduction() }, 'primary'),
    ]
  } else if (stage === 'capturing') {
    right = [
      button('取消追踪', () => { void actions.cancelCapture() }, 'danger'),
      button(busy ? '正在抓取…' : '已复现', () => { void actions.finishReproduction() }, 'primary'),
    ]
  } else {
    right = [button('关闭', actions.close), button('追踪新问题', () => { void actions.reset() }, 'primary')]
  }

  return h(
    'footer',
    { className: 'dbk-footer' },
    h('span', { className: 'dbk-help' }, '日志不会自动发送，最终由你确认。'),
    h('div', { className: 'dbk-actions' }, ...right),
  )
}

function summaryCard(h: typeof React.createElement, state: StoredState, cwd: string): React.ReactNode {
  return h(
    'div',
    { className: 'dbk-card' },
    h('h3', { className: 'dbk-card-title' }, state.issue),
    h(
      'div',
      { className: 'dbk-meta' },
      h('span', { className: 'dbk-meta-key' }, '日志'),
      h('span', { className: 'dbk-meta-value' }, state.logPath),
      h('span', { className: 'dbk-meta-key' }, '工作区'),
      h('span', { className: 'dbk-meta-value' }, cwd || '不可用'),
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
  if (state.logPath.trim() === '') return '请选择或填写 Spring 日志文件。'
  if (cwd === '') return '当前 DSH 会话没有工作区路径，无法把日志读取限制在项目内。'
  return ''
}

function composerIsEmpty(props: BugKillerButtonProps): boolean {
  return props.input.phase === 'plain' && props.input.draft.trim() === ''
}

function labelFor(stage: Stage): string {
  if (stage === 'instrumenting') return '待复现'
  if (stage === 'capturing') return '追踪中'
  if (stage === 'ready') return '待发送'
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
    && typeof candidate.expected === 'string'
    && typeof candidate.actual === 'string'
    && typeof candidate.logPath === 'string'
    && typeof candidate.traceId === 'string'
    && (candidate.stage === 'setup'
      || candidate.stage === 'instrumenting'
      || candidate.stage === 'capturing'
      || candidate.stage === 'ready')
    && (candidate.startedAt === undefined || typeof candidate.startedAt === 'number')
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}
