# Upstream merge: what still has to be ported

`upstream/dev` removed `packages/opencode` (legacy V1 runtime) and rewrote the TUI and the app composer on the V2 stack
(`packages/core`, `packages/cli`, `packages/server`, `packages/schema`). The fork's code in those places was not
carried over by the merge; it is recoverable from `main` (the pre-merge fork head) and must be re-hooked on the V2 code.

`packages/fork` (pure logic, 100 files) merged cleanly; only its imports of `Global` moved to `@opencode/util/global`.
`packages/fork/test/flags.test.ts` fails until the glue that reads the `OPENCODE_FORK_*` variables is ported: it is the
completeness gauge for this port.

Recover a file or the whole fork diff of an area:

```
git show main:<path>
git diff $(git merge-base main upstream/dev) main -- packages/opencode/src/<area>
```

## Not ported (taken from upstream)

| Area | Fork code on `main` | Where it goes now |
| --- | --- | --- |
| Session loop glue: route, small model, classify, handoff, messaging, permission, preload, prune, suggest, smart compaction | `packages/opencode/src/session/fork-*.ts`, patches in `prompt.ts`, `llm.ts`, `processor.ts`, `compaction.ts` | `packages/core/src/session/` (runner, compaction) |
| Provider routing | `packages/opencode/src/provider/fork-route.ts`, `provider.ts` | `packages/core` provider resolution |
| Tools: workflow, monitor, shell-background, shell-promote, sandbox, worktrees, messaging, wakeup, plan, task, grep/lsp/shell patches | `packages/opencode/src/tool/*` | `packages/core/src/tool/` (V2 tool format) |
| CLI: auto, schedule, usage, workflow, plugin-cc | `packages/opencode/src/cli/cmd/*` | `packages/cli/src/commands/handlers/` |
| Plugin hooks, guard | `packages/opencode/src/plugin/fork-*.ts` | `packages/core` plugin |
| Fork HTTP group/handler | `packages/opencode/src/server/routes/instance/httpapi/{groups,handlers}/fork.ts` | `packages/protocol`, `packages/server` |
| Config blocks `hooks`, `sandbox`, `fork` (`ConfigHooks`, `ConfigSandbox`, `ConfigFork`) | `packages/core/src/config.ts`, `v1/config/migrate.ts` | `packages/schema/src/config*` |
| TUI: fork usage/compaction/statusline/prompt-suggestion plugins, running-tasks, working-line, permission modes, thinking, queued/running message styling | `packages/tui/src/**` | V2 TUI |
| App: fork usage in the context tab, permission mode cycle, prompt suggestions, fork i18n keys (`command.mode.cycle*`, `context.fork.*`, `prompt.forkMode.*`), Syacode branding | `packages/app/src/**`, `packages/app/src/i18n/*` | `packages/app/src/composer`, `runtime/i18n` |

## Re-applied during the merge

- busy-retry seam in `packages/core/src/database/sqlite.{bun,node}.ts` and `busy.ts`
- ripgrep `collect` and `search` seams in `packages/core/src/ripgrep.ts`

Files named `fork-*` that `git` proposed to move into `packages/core/src/tool` were left out on purpose: they are written
for the V1 tool runtime and would not compile there.
