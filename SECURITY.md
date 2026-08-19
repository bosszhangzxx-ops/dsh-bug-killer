# Security policy

## Trust model

`dsh-bug-killer` runs locally inside DeepSeek Harness and handles three different trust levels:

1. The user-entered issue description is intentional input.
2. The selected project and log paths are untrusted until canonicalized and checked against the active DSH workspace.
3. Every captured log line is untrusted data. Logs may contain user-controlled HTTP fields, database values, copied prompts, shell commands, or deliberate prompt-injection text.

## Enforced boundaries

- The browser-to-host channel is registered with DSH's `loopback` authority.
- The host resolves the DSH workspace, selected project, and log file through `realpath`. The project must be the workspace itself or a descendant, and the log must be inside that project.
- Symbolic-link escapes and `..` traversal do not pass the containment check.
- Only regular files are accepted.
- Captures have a bounded byte budget.
- Readiness polling inspects only file existence, size, and modification time inside the selected project; it does not expose log contents until reproduction is finished.
- Common credentials and authorization values are redacted before the result crosses into the browser.
- Captured lines are escaped, prefixed as evidence, and wrapped in an explicit untrusted-data section.
- Generated prompts forbid following instructions from logs, accessing paths outside the workspace, destructive commands, and unrelated refactors.
- Clicking **Start tracing** authorizes instrumentation; **Reproduced** authorizes diagnosis and repair; **Solved, and remove instrumentation logs** authorizes removal of this trace's temporary instrumentation. The browser writes each prompt through `inputActions.setDraft()` and then calls `submit()` automatically.
- Capture and browser-to-host transport are local, but diagnosis is not offline: after **Reproduced**, selected log evidence is included in a DSH prompt and processed by the model provider configured in DSH.

## Deliberate limitations

- Redaction is defense in depth, not a guarantee that every application-specific secret format will be recognized.
- Prompt-injection framing reduces risk but cannot make an LLM mathematically immune to malicious text. Review DSH's code diff and test results before accepting a fix.
- The plugin does not add its own telemetry or upload service, but users must treat the configured DSH model provider as a recipient of the selected evidence.
- The plugin reads file logs only. It does not attach to IntelliJ console output, JVM memory, a production host, Docker, Kubernetes, or remote log platforms.
- Diagnosis keeps instrumentation until the user verifies the result. The separate cleanup task removes entries carrying the current trace ID only after **Solved, and remove instrumentation logs**; if cleanup is interrupted, the UI reports a cleanup error and the trace ID remains available for a manual search.

## Reporting a vulnerability

Open a GitHub issue without including real credentials, private logs, or proprietary source code. For a sensitive report, contact the repository owner through the private contact method listed on their GitHub profile.
