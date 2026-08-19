# dsh-bug-killer

> Bugs lie. Logs don't. You reproduce it; Bug Killer brings the evidence back to DSH.

`dsh-bug-killer` is a local debugging plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It turns a repetitive workflow—instrument, restart, reproduce, copy logs, prompt the agent—into one guided flow next to the composer.

English | [简体中文](README.zh.md)

## Workflow

1. Click **Bug Killer** next to the DSH send button.
2. Describe the issue, expected behavior, actual behavior, and Spring log file.
3. Click **Start tracing**. The plugin puts a focused instrumentation prompt in the composer for you to review and send.
4. Let DSH add temporary trace logs, then restart the local Spring service.
5. Click **Start reproduction**. The host records the log file's current byte offset.
6. Reproduce the business issue in your application.
7. Click **Reproduced**. The host reads only bytes written after the offset and puts a guarded diagnosis prompt in the composer.
8. Review and manually send the evidence to DSH.

The plugin never auto-sends a prompt and never edits application code by itself.

## Highlights

- Native DSH Web composer button and four-stage dialog.
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
- A Spring log file inside the active DSH workspace

Bug Killer cannot read the IntelliJ IDEA Run/Debug console. Configure file logging if the application currently logs only to the console:

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
