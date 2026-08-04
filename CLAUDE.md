# SKB v1.3.4 联机版 — Claude 工作指引

## 必读入口

- **`AGENTS.md`** — 仓库协作说明，开始任何任务前先完整阅读（含每任务必读清单、编辑原则、上下文维护规则、当前 Goal 交接）。
- **`hot.md`** — 高频恢复上下文：当前阶段、最新实现与验证状态、必读恢复入口、稳定规则与实现约束。发生规则裁定/阶段变更时更新它。
- **`docs/整理/00-规则整理索引.md`** — 规则整理文档总索引，按文档编号定位每一份说明。
- 任务涉及既有裁定时，必须读 `docs/整理/04-第一轮正式裁定.md` 及后续正式裁定，不得仅凭原始规则覆盖已确认裁定。

## 项目概况

四人 2v2、服务器权威、Vue 3 客户端网页联机游戏。规则包 v1.3.4 冻结于 `rulesets/v1.3.4/frozen_baseline`。实现状态与文档见 `docs/整理/`（先读 hot.md 与索引）。

## 目录结构

- `server/` — 权威引擎 `src/engine` + 应用层 `src/app`（房间/会话/投影/注册表/服务器）。
- `client/` — Vue 3 客户端。
- `protocol/v1.3.4/` — 房间与客户端协议 schema。
- `shared/src/generated/` — 由 schema 生成的 TypeScript 类型。
- `rulesets/v1.3.4/` — 冻结规则包。
- `tools/` — 规则构建与协议验证脚本。

## 快速命令

```bash
cd server && npm run build && npm test   # 服务端构建与测试（vitest）
cd client && npm run build && npm test   # 客户端构建与测试
cd server && npm start                   # 启动服务器，默认端口 8787
```

## 协作要点（详见 AGENTS.md）

- 规则冲突优先级：最新补丁 → 通用规则 → 角色/卡牌正文 → 正式裁定 → UI 技术文档 → 旧稿。
- 原始规则资料作来源保留，不直接覆盖；新统一稿写入 `docs/整理/`。
- 服务端是唯一权威；Vue 只消费受众投影和服务器报价，不执行规则。
- 涉及改玩法/数值平衡的事项，不擅自决定，向作者确认。

<!-- agent-lsp:rules:start -->
## agent-lsp Skills

agent-lsp provides 66 code intelligence tools and 23 workflow skills.
Prefer these tools over text search for code intelligence tasks.

**Before editing code:** call `blast_radius` for blast-radius analysis.
**Before applying edits:** call `preview_edit` to preview the diagnostic delta.
**After any change:** call `get_diagnostics`, then `run_build` and `run_tests`.

**Task-to-tool mapping (use these instead of Read/Grep for code):**

| Task | Use this | Not this |
|------|----------|----------|
| See file structure | `list_symbols` | `Read` + manual scanning |
| Find a symbol by name | `find_symbol` | `Grep` across files |
| Find all usages | `find_references` | `Grep` for the name |
| Understand a symbol | `inspect_symbol` | `Read` the file |
| What calls this function | `find_callers` | `Grep` for the name |
| Replace a function body | `replace_symbol_body` | `Edit` with text matching |
| Delete unused symbol | `safe_delete_symbol` | `Edit` to remove lines |

| Skill | Description |
|-------|-------------|
| `/lsp-architecture` | Generate a structural architecture overview of a codebase: languages, package map, entry points, dependency graph, an... |
| `/lsp-concurrency-audit` | Concurrency safety audit for a type or file. Maps all fields, traces which are accessed from concurrent contexts (gor... |
| `/lsp-cross-repo` | Cross-repository analysis — find all callers of a library symbol in one or more consumer repos. Use when refactorin... |
| `/lsp-dead-code` | Enumerate exported symbols in a file and surface those with zero references across the workspace. Use when auditing f... |
| `/lsp-docs` | Three-tier documentation lookup for any symbol — hover → offline toolchain doc → source definition. Use when ho... |
| `/lsp-edit-export` | Safe workflow for editing exported symbols or public APIs. Use when changing a function signature, modifying a public... |
| `/lsp-edit-symbol` | Edit a named symbol without knowing its file or position. Use when you want to change a function, type, or variable b... |
| `/lsp-explore` | Tell me about this symbol": hover + implementations + call hierarchy + references in one pass — for navigating unfa... |
| `/lsp-extract-function` | Extract a selected code block into a named function. Primary path uses the language server's extract-function code ac... |
| `/lsp-fix-all` | Apply available quick-fix code actions for all current diagnostics in a file, one at a time with re-collection betwee... |
| `/lsp-format-code` | Format a file or selection using the language server's formatter. Use before committing to apply consistent style, or... |
| `/lsp-generate` | Trigger language server code generation — implement interface stubs, generate test skeletons, add missing methods, ... |
| `/lsp-impact` | Blast-radius analysis for a symbol or file — shows all callers, type supertypes/subtypes, and reference count befor... |
| `/lsp-implement` | Find all concrete implementations of an interface or abstract type. Use when you need to know what types satisfy an i... |
| `/lsp-inspect` | Full code quality audit for a file, package, or directory. Supports batch mode (directory walk with --top ranking), c... |
| `/lsp-local-symbols` | Fast file-scoped symbol analysis — find all usages of a symbol within the current file, list all symbols defined in... |
| `/lsp-onboard` | First-session project onboarding. Explores the project structure, detects build system, test runner, entry points, an... |
| `/lsp-refactor` | End-to-end safe refactor workflow — blast-radius analysis, speculative preview, apply to disk, verify build, run af... |
| `/lsp-rename` | Two-phase safe rename across the entire workspace. Use when renaming any symbol, function, method, variable, type, or... |
| `/lsp-safe-edit` | Wrap any code edit with before/after diagnostic comparison. Speculatively previews the change first (preview_edit), t... |
| `/lsp-simulate` | Speculative code editing session — simulate changes in memory before touching disk. Use when planning edits that mi... |
| `/lsp-test-correlation` | Find and run the tests that cover a source file. Use after editing a file to discover exactly which test files and te... |
| `/lsp-understand` | Deep-dive exploration of unfamiliar code — given a symbol or file, builds a complete Code Map showing type info, im... |
| `/lsp-verify` | Full three-layer verification after any change — LSP diagnostics + compiler build + test suite, ranked by severity.... |

Call `prompts/get` with any skill name for full workflow instructions.
<!-- agent-lsp:rules:end -->
