import React from 'react'
import {
  RPC_CHANNEL,
  RPC_ENDPOINTS,
  type CaptureFinishResult,
  type CaptureStartResult,
  type CaptureStatusResult,
  type DirectoryListing,
  type DiscoveredLog,
  type LogProbeResult,
} from '../contracts.ts'
import {
  buildCleanupPrompt,
  buildDiagnosisPrompt,
  buildInstrumentationPrompt,
  createTraceId,
  type BugDescription,
} from '../prompts.ts'
import type { BugKillerButtonProps, ClientConnectionLike } from './types.ts'

type Stage = 'setup' | 'instrumenting' | 'restartRequired' | 'checkingLog' | 'capturing' | 'settlingLogs' | 'noIssue' | 'fixing' | 'awaitingResolution' | 'cleaning' | 'failed'

interface StoredState {
  issue: string
  projectPath: string
  logPath: string
  traceId: string
  stage: Stage
  captureStartOffset?: number
  failedTask?: 'instrumentation' | 'diagnosis' | 'cleanup'
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
    const cleanupRan = React.useRef(false)

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
          setStored(current => {
            if (current.stage !== 'instrumenting') return current
            return props.session.promptError == null
              ? { ...current, stage: 'restartRequired' }
              : { ...current, stage: 'failed', failedTask: 'instrumentation' }
          })
          setOpen(true)
        }
      }
      if (stored.stage === 'fixing') {
        if (props.session.running) diagnosisRan.current = true
        if (!props.session.running && diagnosisRan.current) {
          diagnosisRan.current = false
          setStored(current => current.stage === 'fixing'
            ? props.session.promptError == null
              ? { ...current, stage: 'awaitingResolution' }
              : { ...current, stage: 'failed', failedTask: 'diagnosis' }
            : current)
        }
      }
      if (stored.stage === 'cleaning') {
        if (props.session.running) cleanupRan.current = true
        if (!props.session.running && cleanupRan.current) {
          cleanupRan.current = false
          if (props.session.promptError == null) {
            setStored(current => ({ ...EMPTY_STATE, projectPath: current.projectPath }))
            clearState(props.sessionId)
            setOpen(false)
          } else {
            setStored(current => current.stage === 'cleaning'
              ? { ...current, stage: 'failed', failedTask: 'cleanup' }
              : current)
            setOpen(true)
          }
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
            if (current.stage !== 'checkingLog' && current.stage !== 'capturing' && current.stage !== 'settlingLogs' && current.stage !== 'noIssue') return current
            const next: StoredState = { ...current, stage: 'restartRequired' }
            delete next.startedAt
            delete next.captureStartOffset
            return next
          })
          return
        }
        setStored(current => ({
          ...current,
          stage: 'capturing',
          logPath: status.relativePath ?? current.logPath,
          ...(status.startOffset === undefined ? {} : { captureStartOffset: status.startOffset }),
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
        const selectedLog = found[0]
        const logPath = selectedLog?.relativePath ?? 'logs/bug-killer.log'
        const description: BugDescription = {
          issue: stored.issue,
          projectPath: stored.projectPath,
          logPath,
          traceId,
        }
        instrumentationRan.current = false
        setStored(current => {
          const next: StoredState = {
            ...current,
            traceId,
            logPath,
            stage: 'instrumenting',
          }
          delete next.failedTask
          delete next.startedAt
          delete next.captureStartOffset
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
      setStored(current => ({ ...current, stage: 'checkingLog' }))
      try {
        await waitForStableLog(() => probeLog(connection, cwd, stored.projectPath, stored.logPath))
        const result = await callRpc<CaptureStartResult>(connection, RPC_ENDPOINTS.start, {
          sessionId: props.sessionId,
          rootCwd: cwd,
          cwd: stored.projectPath,
          logPath: stored.logPath,
        })
        setStored(current => ({
          ...current,
          stage: 'capturing',
          logPath: result.relativePath,
          startedAt: result.startedAt,
          captureStartOffset: result.startOffset,
        }))
      } catch (reason) {
        setError(messageOf(reason))
        setStored(current => current.stage === 'checkingLog'
          ? { ...current, stage: 'restartRequired' }
          : current)
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
      setStored(current => ({ ...current, stage: 'settlingLogs' }))
      try {
        await waitForReproductionLog(
          () => probeLog(connection, cwd, stored.projectPath, stored.logPath),
          stored.captureStartOffset ?? 0,
        )
        const result = await callRpc<CaptureFinishResult>(connection, RPC_ENDPOINTS.finish, {
          sessionId: props.sessionId,
        })
        if (result.empty) {
          setStored(current => ({ ...current, stage: 'noIssue' }))
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
        setStored(current => current.stage === 'settlingLogs'
          ? { ...current, stage: 'capturing' }
          : current)
      } finally {
        setBusy(false)
      }
    }

    const reset = async (): Promise<void> => {
      if (stored.stage === 'capturing' || stored.stage === 'settlingLogs' || stored.stage === 'noIssue') {
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

    const confirmResolved = (): void => {
      if (props.session.running || !composerIsEmpty(props)) {
        setError('当前 DSH 会话还不能提交清理任务，请等待输入框恢复空闲后重试。')
        return
      }
      const description: BugDescription = {
        issue: stored.issue,
        projectPath: stored.projectPath,
        logPath: stored.logPath,
        traceId: stored.traceId,
      }
      cleanupRan.current = false
      setStored(current => {
        const next: StoredState = { ...current, stage: 'cleaning' }
        delete next.failedTask
        return next
      })
      submitPrompt(props, buildCleanupPrompt(description))
    }

    const confirmUnresolved = (): void => {
      setError('')
      setStored(current => {
        const next: StoredState = { ...current, stage: 'restartRequired' }
        delete next.startedAt
        delete next.captureStartOffset
        return next
      })
      setOpen(true)
    }

    const statusLabel = labelFor(stored.stage, stored.failedTask)
    const statusNeedsAttention = stored.stage === 'awaitingResolution'
    const statusLive = stored.stage === 'instrumenting'
      || stored.stage === 'checkingLog'
      || stored.stage === 'settlingLogs'
      || stored.stage === 'fixing'
      || stored.stage === 'cleaning'
    const trigger = h(
      'button',
      {
        type: 'button',
        className: `dbk-trigger${statusNeedsAttention ? ' dbk-trigger-attention' : ''}`,
        disabled: props.input.phase !== 'plain',
        title: '自动埋点、采集日志并交给 DSH 修复',
        onClick: () => {
          setError('')
          if (stored.stage === 'cleaning') return
          setOpen(true)
        },
      },
      h('span', { className: `dbk-dot${statusLive ? ' dbk-dot-live' : ''}${statusNeedsAttention ? ' dbk-dot-attention' : ''}` }),
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
        renderFooter(h, stored.stage, stored.failedTask, busy, {
          startTracking,
          startReproduction,
          finishReproduction,
          confirmUnresolved,
          confirmResolved,
          retryCleanup: confirmResolved,
          reset,
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
  if (state.stage === 'capturing' || state.stage === 'noIssue') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, state.stage === 'noIssue' ? '暂未发现问题' : '请复现刚才出现的问题'),
      h('p', null, state.stage === 'noIssue'
        ? '暂时没有检测到新增日志。请再次完整复现问题，完成后点击“已复现”。'
        : '日志已经准备好并记录起点。请去业务页面复现问题，完成后点击“已复现”。'),
    )
  }

  if (state.stage === 'checkingLog') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), '正在等待日志文件就绪'),
      h('p', null, '项目刚启动时日志可能尚未写完，Bug Killer 正在自动检查，无需重复点击。'),
    )
  }

  if (state.stage === 'settlingLogs') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), '正在等待复现日志写入完成'),
      h('p', null, '检测到日志稳定后会自动读取，并把证据交给 DSH。'),
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

  if (state.stage === 'restartRequired') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, '已完成日志埋点，请重启项目'),
      h('p', null, '如果项目已经重启或本次无需重启，请点击“已重启”。'),
    )
  }

  if (state.stage === 'fixing') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('div', { className: 'dbk-live-row' }, h('span', { className: 'dbk-dot dbk-dot-live' }), options.running ? 'DSH 正在根据日志定位并修复' : '正在提交日志证据'),
      h('p', null, '修复任务已经自动发送。完成后，Bug Killer 会进入“待确认”状态，由你确认问题是否解决。'),
    )
  }

  if (state.stage === 'awaitingResolution') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, '请确认刚才的问题是否解决'),
      h('p', null, '如果问题仍然存在，可以继续复现并提交新的日志；如果已经解决，可以删除本次临时埋点日志。'),
    )
  }

  if (state.stage === 'cleaning') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, '正在清理临时日志埋点'),
      h('p', null, '清理完成后 Bug Killer 会自动恢复到初始状态。'),
    )
  }

  if (state.stage === 'failed') {
    return h(
      'div',
      { className: 'dbk-card' },
      h('h3', { className: 'dbk-card-title' }, state.failedTask === 'cleanup'
        ? '清理任务未正常完成'
        : state.failedTask === 'diagnosis' ? '修复任务未正常完成' : '埋点任务未正常完成'),
      h('p', null, state.failedTask === 'cleanup'
        ? '请查看 DSH 会话里的错误。本次临时埋点可能仍有残留。'
        : state.failedTask === 'diagnosis'
          ? '请查看 DSH 会话里的错误，临时埋点仍然保留，可以修正后继续复现。'
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
  failedTask: StoredState['failedTask'],
  busy: boolean,
  actions: {
    startTracking(): Promise<void>
    startReproduction(): Promise<void>
    finishReproduction(): Promise<void>
    confirmUnresolved(): void
    confirmResolved(): void
    retryCleanup(): void
    reset(): Promise<void>
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
    right = [button('取消', actions.close, '', false), button(busy ? '正在准备…' : '开始追踪', () => { void actions.startTracking() }, 'primary')]
  } else if (stage === 'instrumenting') {
    right = [button('关闭', actions.close)]
  } else if (stage === 'restartRequired') {
    right = [button('取消', actions.close, '', false), button('已重启', () => { void actions.startReproduction() }, 'primary')]
  } else if (stage === 'checkingLog') {
    right = [button('取消', actions.close, '', false), button('正在检查日志…', () => {}, 'primary', true)]
  } else if (stage === 'capturing' || stage === 'noIssue') {
    right = [
      button('取消', actions.close, '', false),
      button('已复现', () => { void actions.finishReproduction() }, 'primary'),
    ]
  } else if (stage === 'settlingLogs') {
    right = [button('取消', actions.close, '', false), button('正在等待日志…', () => {}, 'primary', true)]
  } else if (stage === 'fixing') {
    right = [button('关闭', actions.close)]
  } else if (stage === 'awaitingResolution') {
    right = [
      button('未解决', actions.confirmUnresolved, '', false),
      button('已解决，并删除埋点日志', actions.confirmResolved, 'primary'),
    ]
  } else if (stage === 'cleaning') {
    right = [button('关闭', actions.close)]
  } else if (stage === 'failed') {
    right = failedTask === 'cleanup'
      ? [button('关闭', actions.close), button('重新清理', actions.retryCleanup, 'primary')]
      : [button('关闭', actions.close), button('追踪新问题', () => { void actions.reset() }, 'primary')]
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

function labelFor(stage: Stage, failedTask?: StoredState['failedTask']): string {
  if (stage === 'setup') return '未开始'
  if (stage === 'instrumenting') return '埋点中'
  if (stage === 'restartRequired') return '待重启'
  if (stage === 'checkingLog' || stage === 'settlingLogs') return '检查日志'
  if (stage === 'capturing' || stage === 'noIssue') return '未发现问题'
  if (stage === 'fixing') return '已定位问题'
  if (stage === 'awaitingResolution') return '待确认'
  if (stage === 'cleaning') return '清理中'
  if (stage === 'failed') return failedTask === 'cleanup' ? '清理异常' : '执行异常'
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
      || candidate.stage === 'restartRequired'
      || candidate.stage === 'checkingLog'
      || candidate.stage === 'capturing'
      || candidate.stage === 'settlingLogs'
      || candidate.stage === 'noIssue'
      || candidate.stage === 'fixing'
      || candidate.stage === 'awaitingResolution'
      || candidate.stage === 'cleaning'
      || candidate.stage === 'failed')
    && (candidate.failedTask === undefined
      || candidate.failedTask === 'instrumentation'
      || candidate.failedTask === 'diagnosis'
      || candidate.failedTask === 'cleanup')
    && (candidate.startedAt === undefined || typeof candidate.startedAt === 'number')
    && (candidate.captureStartOffset === undefined || typeof candidate.captureStartOffset === 'number')
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function submitPrompt(props: BugKillerButtonProps, prompt: string): void {
  props.inputActions.setDraft(prompt)
  queueMicrotask(() => props.inputActions.submit())
}

async function probeLog(
  connection: ClientConnectionLike,
  rootCwd: string,
  projectCwd: string,
  logPath: string,
): Promise<LogProbeResult> {
  return callRpc<LogProbeResult>(connection, RPC_ENDPOINTS.probe, {
    rootCwd,
    cwd: projectCwd,
    logPath,
  })
}

async function waitForStableLog(probe: () => Promise<LogProbeResult>): Promise<void> {
  let previous: LogProbeResult | undefined
  let stableChecks = 0
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await probe()
    stableChecks = current.exists && previous?.exists && sameLogVersion(current, previous)
      ? stableChecks + 1
      : 0
    if (stableChecks >= 2) return
    previous = current
    await waitForNextPoll()
  }
  throw new Error('暂未检测到稳定的日志文件。请确认项目已经启动并正在写入日志，然后再次点击“已重启”。')
}

async function waitForReproductionLog(
  probe: () => Promise<LogProbeResult>,
  startOffset: number,
): Promise<void> {
  let previous: LogProbeResult | undefined
  let changed = false
  let stableChecks = 0
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const current = await probe()
    if (current.exists && current.size !== startOffset) changed = true
    stableChecks = changed && current.exists && previous?.exists && sameLogVersion(current, previous)
      ? stableChecks + 1
      : 0
    if (stableChecks >= 2) return
    previous = current
    await waitForNextPoll()
  }
}

function sameLogVersion(left: LogProbeResult, right: LogProbeResult): boolean {
  return left.size === right.size && left.modifiedAt === right.modifiedAt
}

function waitForNextPoll(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 750))
}
