import Schema from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/contracts.d.ts
declare const RPC_CHANNEL = "/bug-killer";
declare const RPC_ENDPOINTS: {
  readonly health: "health";
  readonly listDirectories: "directories/list";
  readonly discover: "logs/discover";
  readonly probe: "logs/probe";
  readonly start: "capture/start";
  readonly finish: "capture/finish";
  readonly cancel: "capture/cancel";
  readonly status: "capture/status";
};
interface DiscoverLogsRequest {
  cwd: string;
  rootCwd?: string;
}
interface ProjectDirectory {
  name: string;
  path: string;
}
interface DirectoryListing {
  rootPath: string;
  currentPath: string;
  parentPath?: string;
  directories: ProjectDirectory[];
}
interface DiscoveredLog {
  relativePath: string;
  size: number;
  modifiedAt: number;
}
interface ProbeLogRequest {
  cwd: string;
  rootCwd?: string;
  logPath: string;
}
interface LogProbeResult {
  exists: boolean;
  relativePath: string;
  size: number;
  modifiedAt: number;
}
interface StartCaptureRequest {
  sessionId: string;
  cwd: string;
  rootCwd?: string;
  logPath: string;
}
interface FinishCaptureRequest {
  sessionId: string;
}
interface CaptureStatusRequest {
  sessionId: string;
}
interface CaptureStartResult {
  sessionId: string;
  relativePath: string;
  startOffset: number;
  startedAt: number;
}
interface CaptureFinishResult {
  sessionId: string;
  relativePath: string;
  startedAt: number;
  finishedAt: number;
  totalNewBytes: number;
  capturedBytes: number;
  omittedBytes: number;
  rotated: boolean;
  empty: boolean;
  logText: string;
  warnings: string[];
}
interface CaptureStatusResult {
  active: boolean;
  sessionId: string;
  relativePath?: string;
  startedAt?: number;
  startOffset?: number;
}
interface RpcErrorShape {
  code: string;
  message: string;
  details: Record<string, unknown>;
}
type RpcResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: RpcErrorShape;
};
//#endregion
//#region src/log-capture.d.ts
interface CaptureManagerConfig {
  maxCaptureBytes: number;
  maxDiscoveryDepth: number;
  redactSecrets: boolean;
}
declare class LogCaptureManager {
  private readonly sessions;
  private readonly config;
  constructor(config: CaptureManagerConfig);
  discoverLogs(cwdInput: unknown): Promise<DiscoveredLog[]>;
  probeLog(cwdInput: unknown, logPathInput: unknown): Promise<LogProbeResult>;
  start(sessionInput: unknown, cwdInput: unknown, logPathInput: unknown): Promise<CaptureStartResult>;
  finish(sessionInput: unknown): Promise<CaptureFinishResult>;
  cancel(sessionInput: unknown): {
    cancelled: boolean;
  };
  status(sessionInput: unknown): CaptureStatusResult;
  private walk;
}
//#endregion
//#region src/project-directory.d.ts
declare function resolveProjectDirectory(rootInput: unknown, directoryInput: unknown): Promise<string>;
declare function listProjectDirectories(rootInput: unknown, directoryInput: unknown): Promise<DirectoryListing>;
//#endregion
//#region src/security.d.ts
declare function resolveWorkspaceFile(cwdInput: unknown, fileInput: unknown): Promise<{
  workspaceRoot: string;
  filePath: string;
  relativePath: string;
}>;
declare function redactLogSecrets(input: string): string;
//#endregion
//#region src/prompts.d.ts
interface BugDescription {
  issue: string;
  projectPath: string;
  logPath: string;
  traceId: string;
}
declare function buildInstrumentationPrompt(description: BugDescription): string;
declare function buildDiagnosisPrompt(description: BugDescription, capture: CaptureFinishResult): string;
declare function buildCleanupPrompt(description: BugDescription): string;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-bug-killer";
declare const inject: string[];
interface Config {
  maxCaptureBytes: number;
  maxDiscoveryDepth: number;
  redactSecrets: boolean;
}
declare const Config: Schema<Config>;
interface HostConnectionLike {
  rpc: {
    handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>, options: {
      authority: 'loopback' | 'trusted-host';
    }): () => Promise<void>;
  };
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: HostConnectionLike;
  }
}
declare function apply(ctx: Context, config: Config): void;
declare function createRpcHandler(manager: LogCaptureManager): (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>;
//#endregion
export { type CaptureFinishResult, type CaptureStartResult, type CaptureStatusRequest, type CaptureStatusResult, Config, type DirectoryListing, type DiscoverLogsRequest, type DiscoveredLog, type FinishCaptureRequest, LogCaptureManager, type LogProbeResult, type ProbeLogRequest, type ProjectDirectory, type RPC_CHANNEL, type RPC_ENDPOINTS, type RpcErrorShape, type RpcResult, type StartCaptureRequest, apply, buildCleanupPrompt, buildDiagnosisPrompt, buildInstrumentationPrompt, createRpcHandler, inject, listProjectDirectories, name, redactLogSecrets, resolveProjectDirectory, resolveWorkspaceFile };