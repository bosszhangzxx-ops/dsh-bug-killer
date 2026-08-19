# Security policy

## Trust model

`dsh-bug-killer` runs locally inside DeepSeek Harness and handles three different trust levels:

1. The user-entered issue description is intentional input.
2. The selected log path is untrusted until canonicalized and checked against the active DSH workspace.
3. Every captured log line is untrusted data. Logs may contain user-controlled HTTP fields, database values, copied prompts, shell commands, or deliberate prompt-injection text.

## Enforced boundaries

- The browser-to-host channel is registered with DSH's `loopback` authority.
- The host resolves both the workspace and log file through `realpath` and rejects files outside the canonical workspace root.
- Symbolic-link escapes and `..` traversal do not pass the containment check.
- Only regular files are accepted.
- Captures have a bounded byte budget.
- Common credentials and authorization values are redacted before the result crosses into the browser.
- Captured lines are escaped, prefixed as evidence, and wrapped in an explicit untrusted-data section.
- Generated prompts forbid following instructions from logs, accessing paths outside the workspace, destructive commands, and unrelated refactors.
- The browser only calls `inputActions.setDraft()`. It does not call `submit()`; the user remains the final approval gate.

## Deliberate limitations

- Redaction is defense in depth, not a guarantee that every application-specific secret format will be recognized.
- Prompt-injection framing reduces risk but cannot make an LLM mathematically immune to malicious text. Review the generated composer draft before sending it.
- The plugin reads file logs only. It does not attach to IntelliJ console output, JVM memory, a production host, Docker, Kubernetes, or remote log platforms.
- The plugin does not automatically revert Agent changes. Use Git and review the diff before accepting a fix.

## Reporting a vulnerability

Open a GitHub issue without including real credentials, private logs, or proprietary source code. For a sensitive report, contact the repository owner through the private contact method listed on their GitHub profile.
