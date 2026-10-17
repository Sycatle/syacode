export * as ForkSandboxPlugin from "./fork-sandbox.js"

import { define } from "@opencode/plugin/effect/plugin"
import { ForkSandbox } from "@opencode-fork/core/sandbox"
import { Effect } from "effect"
import { statSync } from "node:fs"
import os from "node:os"
import { Config } from "../config.js"

// FORK-SEAM: sandbox
// Every shell command (foreground, background) runs under bubblewrap when the `sandbox` config block (or
// OPENCODE_FORK_SANDBOX=1) enables it; see docs/fork/sandbox.md. The `sandbox: false` escape and its `sandbox_escape`
// permission live in the shell tool. Not carried over from V1: the `dangerouslyDisableSandbox` name of the Claude Code profile.
export const Plugin = define({
  id: "fork.sandbox",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    let usable: boolean | undefined
    let warned = false

    // bwrap can be installed yet unusable (user namespaces disabled), so try it once for real.
    const bwrapUsable = () =>
      (usable ??=
        Bun.which("bwrap") !== null &&
        Bun.spawnSync(["bwrap", "--ro-bind", "/", "/", "--unshare-all", "true"], {
          stdout: "ignore",
          stderr: "ignore",
        }).exitCode === 0)

    yield* ctx.shell.hook("create.before", (event) =>
      Effect.gen(function* () {
        const sandbox = Config.latest(yield* config.entries(), "sandbox")
        if (!ForkSandbox.enabled(sandbox) || event.sandbox === false) return
        // `cmd` and PowerShell take other arguments than `-c`; the sandbox is Linux only anyway.
        if (!bwrapUsable()) {
          if (warned) return
          warned = true
          return yield* Effect.logWarning(ForkSandbox.UNAVAILABLE_WARNING)
        }
        const project = [ctx.location.project.directory, ctx.location.directory]
        const bwrapArgs = ForkSandbox.args({
          config: sandbox,
          home: os.homedir(),
          // A non-git project has worktree "/", which must never become writable.
          project: Array.from(new Set(project)).filter((dir) => dir !== "/"),
          stat,
        })
        const wrapped = ForkSandbox.wrap(bwrapArgs, event.shell, event.command)
        event.command = `exec ${[wrapped.command, ...wrapped.args].map(quote).join(" ")}`
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.tool !== "shell" || event.status !== "completed") return
        const sandbox = Config.latest(yield* config.entries(), "sandbox")
        if (!ForkSandbox.enabled(sandbox) || (event.input as { sandbox?: boolean }).sandbox === false) return
        const output = event.result.output as { exit?: number; output: string }
        const hint = ForkSandbox.failureHint({
          exit: output.exit ?? null,
          output: output.output,
          networkOpen: ForkSandbox.networkOpen(sandbox),
        })
        if (!hint) return
        const content = event.result.content ?? []
        event.result = {
          ...event.result,
          content: typeof content === "string" ? `${content}\n\n${hint}` : [...content, { type: "text", text: hint }],
        }
      }),
    )
  }),
})

function stat(target: string) {
  const info = statSync(target, { throwIfNoEntry: false })
  if (!info) return undefined
  return info.isDirectory() ? "dir" : "file"
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
