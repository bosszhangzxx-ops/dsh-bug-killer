export const RPC_CHANNEL = '/bug-killer'

export const RPC_ENDPOINTS = {
  health: 'health',
  discover: 'logs/discover',
  start: 'capture/start',
  finish: 'capture/finish',
  cancel: 'capture/cancel',
  status: 'capture/status',
} as const

export interface DiscoverLogsRequest {
  cwd: string
}

export interface DiscoveredLog {
  relativePath: string
  size: number
  modifiedAt: number
}

export interface StartCaptureRequest {
  sessionId: string
  cwd: string
  logPath: string
}

export interface FinishCaptureRequest {
  sessionId: string
}

export interface CaptureStatusRequest {
  sessionId: string
}

export interface CaptureStartResult {
  sessionId: string
  relativePath: string
  startOffset: number
  startedAt: number
}

export interface CaptureFinishResult {
  sessionId: string
  relativePath: string
  startedAt: number
  finishedAt: number
  totalNewBytes: number
  capturedBytes: number
  omittedBytes: number
  rotated: boolean
  empty: boolean
  logText: string
  warnings: string[]
}

export interface CaptureStatusResult {
  active: boolean
  sessionId: string
  relativePath?: string
  startedAt?: number
  startOffset?: number
}

export interface RpcErrorShape {
  code: string
  message: string
  details: Record<string, unknown>
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RpcErrorShape }
