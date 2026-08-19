# dsh-bug-killer

> Bug 会撒谎，日志不会。你负责复现，我负责把证据递给 DSH。

`dsh-bug-killer` 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的本地调试插件。它把“让 Agent 加临时业务日志 → 用户复现 → 只抓复现期间的新日志 → 将证据放回输入框”的人工流程做成一个按钮。

[English](README.md) | 简体中文

## 它解决什么问题

很多业务 Bug 不会抛异常：接口返回成功，但状态没有更新；某个分支走错；数据库写入值不符合预期。开发者通常需要反复加日志、重启、复现、复制日志，再让 AI 修改代码。

Bug Killer 把这个闭环缩短为：

1. 在 DSH 输入框右侧点击 **Bug Killer**。
2. 只填写问题描述，并确认回显的项目目录；如果当前工作目录下有多个项目，可点击“更改”选择其中一个子目录。
3. 点击 **开始追踪**。这次点击即代表授权插件自动把埋点任务发送给 DSH。
4. DSH 先识别项目类型、启动方式和日志配置，再定位完整相关方法链并添加临时埋点，最终只给出简短的重启提示。
5. DSH 回答结束后，Bug Killer 自动弹窗。重启项目并点击 **已重启**。
6. 插件轮询到日志文件稳定后记录字节起点，并提示你复现刚才的问题。
7. 返回 DSH 点击 **已复现**。插件等待尚未落盘的日志稳定，只读取起点之后的内容，再自动发送带安全约束的修复任务。
8. DSH 完成本轮修复尝试后，Bug Killer 按钮下方显示“已解决 / 未解决”确认抽屉。
9. 点击 **未解决** 会保留埋点并重新进入重启—复现循环；点击 **已解决** 才自动清理本次临时埋点，清理完成后重置 Bug Killer。

插件本身不直接修改业务代码；用户点击“开始追踪”“已复现”和最终确认“已解决”后，它会分别提交埋点、修复和清理任务，由 DSH 执行代码改动。

## 能力

- DSH Web 输入框右侧原生按钮，并跟踪埋点与修复任务是否完成。
- 回显当前工作目录，支持在安全边界内选择子项目。
- 埋点前自动识别语言、框架、项目类型、启动方式和日志配置，不限定 Java/Spring。
- DSH 回答结束后自动弹出“已重启—已复现”的分步向导，取消只关闭弹窗。
- 每次修复回答结束后，在 Bug Killer 按钮下方确认“已解决 / 未解决”；未解决时保留埋点继续循环。
- 在开始采集和完成复现时轮询日志文件，避免读取尚未落盘的内容。
- 自动发现当前工作区内最多四层目录中的 `.log` 文件。
- 按字节偏移读取复现窗口，不重复搬运历史日志。
- 检测日志截断或轮转，并从当前文件开头恢复读取。
- 新增日志过大时保留开头和结尾，明确标注省略字节数。
- 自动遮盖 Authorization、Bearer Token、Cookie、密码、API Key 等常见敏感数据。
- 将日志标记为不可信证据，抵御日志中的提示词注入。
- 日志路径经过 `realpath` 校验，拒绝 `../`、符号链接和工作区外文件。
- 浏览器和宿主通过仅限本机的 RPC 通道通信，无云端服务、无遥测、无日志上传。
- TypeScript 严格模式、单元测试、构建冒烟测试和 GitHub Actions CI。

## 前置要求

- Node.js `22.19+` 或 `24+`
- DeepSeek Harness `0.1.0-rc.7` 或兼容版本
- 本地项目能够把日志写入所选项目目录中的普通文件

> Bug Killer 不能直接读取 IntelliJ IDEA 或终端的运行控制台。若项目只有控制台输出，埋点任务会要求 DSH 增加仅用于本地追踪的文件日志配置。

## Spring Boot 日志配置

`application-local.yml` 示例：

```yaml
logging:
  file:
    name: logs/application.log
```

`application-local.properties` 示例：

```properties
logging.file.name=logs/application.log
```

建议只在本地开发环境启用。使用 Logback 自定义配置的项目，只要最终写入工作区内的普通文件即可。

## 安装

```bash
dsh plugin --profile web add github:bosszhangzxx-ops/dsh-bug-killer#main
dsh web
```

仓库已经提交构建好的 `lib/` 产物，从 GitHub 安装时不会在用户电脑上重新构建插件。安装完成后重启 `dsh web`。

需要固定版本时，可以指定 Release 标签或提交：

```bash
dsh plugin --profile web add github:bosszhangzxx-ops/dsh-bug-killer#<tag-or-commit>
```

### 本地开发安装

```bash
pnpm install
pnpm check
pnpm exec dsh plugin --profile web add .
pnpm exec dsh --profile web --dump-config
```

看到 `dsh-bug-killer` 配置层后，使用 `pnpm exec dsh web` 启动 Web UI。

## 使用注意

- 埋点完成后应先重启项目，再点击“已重启”；插件会在日志文件稳定后自动记录起点。
- 日志文件必须已经存在；不存在时插件会明确报错，不会悄悄退化成读取整个目录。
- 单次默认最多携带 1 MiB 日志。超出部分保留首尾，避免撑爆 Agent 上下文。
- “已复现”时若没有新增字节，追踪状态会保留，你可以继续复现后再次尝试。
- 问题表单保存在浏览器当前站点的 `localStorage`，日志正文不会存入浏览器存储。
- DSH 目前仍处于开发者预览阶段，未来破坏性更新可能需要本插件同步适配。

## 配置

安装层 `cordis.patch.yml` 提供以下宿主配置：

| 字段 | 默认值 | 说明 |
| --- | ---: | --- |
| `maxCaptureBytes` | `1048576` | 单次最多读取的新日志字节数，限制在 64 KiB 到 10 MiB |
| `maxDiscoveryDepth` | `4` | 自动发现日志的最大目录深度，限制在 1 到 8 |
| `redactSecrets` | `true` | 返回浏览器前遮盖常见敏感字段 |

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

`pnpm check` 会按以上顺序执行全部检查。测试使用真实文件追加验证增量采集，同时覆盖空日志重试、文件截断、超限首尾保留、日志发现、路径越界和敏感信息遮盖。

## 简历表述参考

> 独立开发 DeepSeek Harness 调试插件 dsh-bug-killer，基于 Web UI Slot 与本机 RPC 打通浏览器交互和宿主文件能力；实现技术栈识别、完整业务链路埋点、字节偏移日志采集、轮转检测、敏感信息脱敏和工作区路径隔离，形成“埋点—复现—证据—Agent 修复—用户验收—自动清理”的反馈闭环，并补齐严格类型检查、自动化测试与 CI。

## 安全

参见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)
