import { describe, expect } from "bun:test"
import { ToolFailure } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { ForkHooksPlugin } from "@opencode/core/plugin/fork-hooks"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Document, Info } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Project } from "@opencode/core/project"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { Effect, Stream } from "effect"
import { existsSync, rmSync } from "node:fs"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_fork_hooks")

// Hooks are shell commands that print the JSON contract on stdout.
const say = (json: unknown) => `printf '%s' '${JSON.stringify(json)}'`

const run = Effect.fnUntraced(function* (hooks: Info["hooks"], events: readonly unknown[] = []) {
  let before: ((event: ToolHooks["execute.before"]) => Effect.Effect<void, Tool.Error>) | undefined
  let after: ((event: ToolHooks["execute.after"]) => Effect.Effect<void>) | undefined
  let evaluate: ((event: PermissionEvaluation) => Effect.Effect<void>) | undefined
  const base = host()
  yield* ForkHooksPlugin.Plugin.effect(
    host({
      location: new Location.Info({
        directory: AbsolutePath.make("/tmp"),
        project: { id: Project.ID.global, directory: AbsolutePath.make("/tmp"), canonical: AbsolutePath.make("/tmp") },
      }),
      tool: {
        ...base.tool,
        hook: ((name: keyof ToolHooks, callback: never) => {
          if (name === "execute.before") before = callback
          else after = callback
          return Effect.succeed({ dispose: Effect.void })
        }) as never,
      },
      permission: {
        ...base.permission,
        hook: ((_: string, callback: never) => {
          evaluate = callback
          return Effect.succeed({ dispose: Effect.void })
        }) as never,
      },
      event: { subscribe: () => Stream.fromIterable(events) as never },
      session: {
        hook: () => Effect.succeed({ dispose: Effect.void }),
        get: () => Effect.succeed({ id: sessionID, agent: "build" }) as never,
      },
    }),
  ).pipe(
    Effect.provide(Config.testLayer([new Document({ type: "document", info: new Info({ hooks }) })])),
    Effect.provideService(Global.Service, Global.Service.of(Global.make())),
  )
  const call = {
    sessionID,
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.make("msg_fork_hooks"),
    id: Tool.CallID.make("call_fork_hooks"),
  }
  return { before: before!, after: after!, evaluate: evaluate!, call }
})

describe("fork hooks plugin", () => {
  it.effect("PreToolUse blocks a call with the hook's reason", () =>
    Effect.gen(function* () {
      const { before, call } = yield* run({
        PreToolUse: [{ matcher: "shell", command: say({ decision: "block", reason: "no shell today" }) }],
      } as Info["hooks"])
      const error = yield* before({ ...call, tool: "shell", input: { command: "ls" } }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(ToolFailure)
      expect(error.message).toBe("no shell today")
      // The matcher leaves other tools alone.
      const event = { ...call, tool: "read", input: { path: "a" } }
      yield* before(event)
      expect(event.input).toEqual({ path: "a" })
    }),
  )

  it.effect("PreToolUse can rewrite the input", () =>
    Effect.gen(function* () {
      const { before, call } = yield* run({
        PreToolUse: [{ command: say({ args: { command: "ls -la" } }) }],
      } as Info["hooks"])
      const event = { ...call, tool: "shell", input: { command: "ls" } }
      yield* before(event)
      expect(event.input).toEqual({ command: "ls -la" })
    }),
  )

  it.effect("PostToolUse appends hook context to the result, PostToolUseFailure to the error", () =>
    Effect.gen(function* () {
      const { after, call } = yield* run({
        PostToolUse: [{ command: say({ additionalContext: "lint clean" }) }],
        PostToolUseFailure: [{ command: say({ additionalContext: "try again" }) }],
      } as Info["hooks"])
      const done: ToolHooks["execute.after"] = {
        ...call,
        tool: "edit",
        input: {},
        status: "completed",
        result: { content: "edited" },
      }
      yield* after(done)
      expect(done.status === "completed" && done.result.content).toBe("edited\n\nlint clean")

      const failed: ToolHooks["execute.after"] = {
        ...call,
        tool: "edit",
        input: {},
        status: "error",
        error: new ToolFailure({ message: "boom" }),
      }
      yield* after(failed)
      expect(failed.status === "error" && failed.error.message).toBe("boom\n\ntry again")
    }),
  )

  it.effect("a blocked call is not reported as a tool failure", () =>
    Effect.gen(function* () {
      const { before, after, call } = yield* run({
        PreToolUse: [{ command: say({ decision: "block" }) }],
        PostToolUseFailure: [{ command: say({ additionalContext: "unexpected" }) }],
      } as Info["hooks"])
      yield* before({ ...call, tool: "shell", input: {} }).pipe(Effect.flip)
      const failed: ToolHooks["execute.after"] = {
        ...call,
        tool: "shell",
        input: {},
        status: "error",
        error: new ToolFailure({ message: "Blocked by PreToolUse hook" }),
      }
      yield* after(failed)
      expect(failed.status === "error" && failed.error.message).toBe("Blocked by PreToolUse hook")
    }),
  )

  it.effect("PermissionRequest decides the permission effect", () =>
    Effect.gen(function* () {
      const { evaluate } = yield* run({
        PermissionRequest: [{ command: say({ decision: "deny", reason: "policy" }) }],
      } as Info["hooks"])
      const event: PermissionEvaluation = { sessionID, action: "shell", resources: ["rm -rf /"], effect: "ask" }
      yield* evaluate(event)
      expect(event.effect).toBe("deny")
      expect(event.message).toBe("policy")
    }),
  )

  it.effect("Stop fires when a root session finishes executing", () =>
    Effect.gen(function* () {
      const marker = `/tmp/fork-hooks-stop-${process.pid}`
      rmSync(marker, { force: true })
      yield* run({ Stop: [{ command: `touch ${marker}` }] } as Info["hooks"], [
        { type: "session.execution.succeeded", data: { sessionID } },
      ])
      yield* Effect.promise(async () => {
        for (let i = 0; i < 50 && !existsSync(marker); i++) await Bun.sleep(20)
      })
      expect(existsSync(marker)).toBe(true)
      rmSync(marker, { force: true })
    }),
  )
})
