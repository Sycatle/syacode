import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { ForkSandboxPlugin } from "@opencode/core/plugin/fork-sandbox"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Document, Info } from "@opencode/schema/config"
import { Effect } from "effect"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { it } from "../lib/effect"
import { host } from "./host"

const usable =
  process.platform === "linux" &&
  Bun.which("bwrap") !== null &&
  Bun.spawnSync(["bwrap", "--ro-bind", "/", "/", "--unshare-all", "true"], { stdout: "ignore", stderr: "ignore" })
    .exitCode === 0

const load = Effect.fnUntraced(function* (directory: string, sandbox: Info["sandbox"]) {
  let hook: ((event: ShellCreateBefore) => Effect.Effect<void>) | undefined
  let after: ((event: ToolHooks["execute.after"]) => Effect.Effect<void>) | undefined
  const base = host()
  yield* ForkSandboxPlugin.Plugin.effect(
    host({
      location: new Location.Info({
        directory: AbsolutePath.make(directory),
        project: {
          id: Project.ID.global,
          directory: AbsolutePath.make(directory),
          canonical: AbsolutePath.make(directory),
        },
      }),
      tool: {
        ...base.tool,
        hook: ((_: string, callback: never) => {
          after = callback
          return Effect.succeed({ dispose: Effect.void })
        }) as never,
      },
      shell: {
        ...base.shell,
        hook: ((_: string, callback: never) => {
          hook = callback
          return Effect.succeed({ dispose: Effect.void })
        }) as never,
      },
    }),
  ).pipe(Effect.provide(Config.testLayer([new Document({ type: "document", info: new Info({ sandbox }) })])))
  return { hook: hook!, after: after! }
})

const rewrite = Effect.fnUntraced(function* (
  directory: string,
  sandbox: Info["sandbox"],
  command: string,
  escape?: boolean,
) {
  const plugin = yield* load(directory, sandbox)
  const event: ShellCreateBefore = {
    command,
    cwd: directory,
    timeout: 0,
    shell: "/bin/sh",
    env: {},
    sandbox: escape,
  }
  yield* plugin.hook(event)
  return event
})

const sandboxed = usable ? it.effect : it.effect.skip

describe("fork sandbox plugin", () => {
  it.effect("leaves the command alone when the sandbox is off", () =>
    Effect.gen(function* () {
      const event = yield* rewrite("/tmp", undefined, "echo hi")
      expect(event.command).toBe("echo hi")
    }),
  )

  it.effect("leaves the command alone when the call asked to leave the sandbox", () =>
    Effect.gen(function* () {
      const event = yield* rewrite("/tmp", { enabled: true } as Info["sandbox"], "echo hi", false)
      expect(event.command).toBe("echo hi")
    }),
  )

  it.effect("appends a hint when a sandboxed command fails on a read-only file system", () =>
    Effect.gen(function* () {
      const plugin = yield* load("/tmp", { enabled: true } as Info["sandbox"])
      const event = {
        tool: "shell",
        status: "completed",
        input: { command: "touch /etc/x" },
        result: {
          output: { exit: 1, output: "touch: Read-only file system", truncated: false },
          content: [{ type: "text", text: "touch: Read-only file system" }],
        },
      } as unknown as Extract<ToolHooks["execute.after"], { status: "completed" }>
      yield* plugin.after(event)
      expect(JSON.stringify(event.result.content)).toContain("[sandbox]")
    }),
  )

  sandboxed("confines writes to the project and /tmp, and hides the network when closed", () =>
    Effect.gen(function* () {
      const project = mkdtempSync(path.join(tmpdir(), "fork-sandbox-"))
      const outside = path.join(process.env.HOME ?? "/root", ".fork-sandbox-probe")
      try {
        const event = yield* rewrite(
          project,
          { enabled: true, network: { allow: [] } } as Info["sandbox"],
          `echo ok > ${project}/inside; echo no > ${outside}; echo $?`,
        )
        const result = Bun.spawnSync(["/bin/sh", "-c", event.command], { cwd: project })
        expect(existsSync(path.join(project, "inside"))).toBe(true)
        expect(existsSync(outside)).toBe(false)
        expect(result.stdout.toString().trim()).not.toBe("0")
      } finally {
        rmSync(project, { recursive: true, force: true })
        rmSync(outside, { force: true })
      }
    }),
  )
})
