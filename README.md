# dsh-bug-killer

> Bugs lie. Logs don't. You reproduce it; Bug Killer brings the evidence back to DSH.

`dsh-bug-killer` is a local debugging plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It turns a repetitive workflow—instrument, restart, reproduce, copy logs, prompt the agent—into one guided flow next to the composer.

English | [简体中文](README.zh.md)

## Workflow

1. Click **Bug Killer** next to the DSH send button.
2. Describe the issue and confirm the echoed project folder. If the DSH workspace contains multiple projects, choose one of its subdirectories.
3. Click **Start tracing**. This click authorizes Bug Killer to send the instrumentation task to DSH automatically.
4. DSH identifies the project type and logging setup, traces the relevant method chain, and answers with only a short restart instruction.
5. When DSH finishes, Bug Killer opens automatically. Restart the application and click **Restarted**.
6. The plugin waits until the log file is stable, records its byte offset, and asks you to reproduce the issue.
7. Click **Reproduced**. Bug Killer waits for pending log writes to settle, reads only bytes written after the offset, and automatically sends a guarded diagnosis task to DSH.
8. DSH fixes the issue, runs relevant checks, and removes only the temporary instrumentation associated with this trace ID.

Bug Killer itself does not edit application code. It submits two explicit DSH tasks after the user's **Start tracing** and **Reproduced** clicks; DSH performs and reports the code changes.

## Highlights

- Native DSH Web composer button with automatic task-completion tracking.
- A workspace-bounded project-folder picker for multi-project working directories.
- Technology-neutral project and logging discovery before instrumentation.
- Guided restart/reproduction dialogs that open when the DSH task settles.
- Log-file polling before capture and after reproduction to avoid racing buffered writes.
- Workspace-scoped `.log` discovery.
- Byte-offset incremental capture with truncation/rotation recovery.
- Head-and-tail retention when a capture exceeds its size budget.
- Redaction for common authorization headers, cookies, tokens, API keys, and passwords.
- Explicit untrusted-evidence framing to reduce log-based prompt injection risk.
- Canonical-path containment that rejects traversal, symlink escapes, and files outside the workspace.
- Loopback-only browser-to-host RPC; no cloud service, telemetry, or log upload.
- Strict TypeScript, real-file integration tests, build smoke tests, and CI.

## Requirements

- Node.js `22.19+` or `24+`
- DeepSeek Harness `0.1.0-rc.7` or a compatible release
- A local application whose file log can be placed inside the selected project folder

Bug Killer reads files rather than IDE or terminal consoles. If the application currently logs only to a console, the instrumentation task asks DSH to add a local-only file logger. For Spring Boot, that may look like:

```yaml
logging:
  file:
    name: logs/application.log
```

## Install

```bash
dsh plugin --profile web add github:bosszhangzxx-ops/dsh-bug-killer#main
dsh web
```

The repository includes prebuilt `lib/` artifacts, so a GitHub install does not build the plugin on the user's machine. Restart `dsh web` after installation.

Pin a release or commit for reproducible installs:

```bash
dsh plugin --profile web add github:bosszhangzxx-ops/dsh-bug-killer#<tag-or-commit>
```

## Local development

```bash
pnpm install
pnpm check
pnpm exec dsh plugin --profile web add .
pnpm exec dsh --profile web --dump-config
```

Run `pnpm exec dsh web` when you want to open the Web UI.

## Configuration

| Field | Default | Purpose |
| --- | ---: | --- |
| `maxCaptureBytes` | `1048576` | Maximum new log bytes retained per capture (64 KiB–10 MiB) |
| `maxDiscoveryDepth` | `4` | Maximum directory depth for automatic log discovery (1–8) |
| `redactSecrets` | `true` | Redact common secrets before evidence reaches the browser |

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

The tests append real Spring-style log lines to real files and cover incremental reads, empty retries, truncation/rotation, bounded captures, discovery, path containment, redaction, prompt framing, and the host RPC boundary.

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
