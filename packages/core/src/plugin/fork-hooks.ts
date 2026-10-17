export * as ForkHooksPlugin from "./fork-hooks.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { ForkClaudePlugins } from "@opencode-fork/core/claude-plugins"
import { ForkHooks } from "@opencode-fork/core/hooks"
import { Effect, Stream } from "effect"
import { Config } from "../config.js"

// FORK-SEAM: hooks-plugin
// Declarative `hooks` from the config: shell commands, HTTP posts and small-model prompts (see ForkHooks for the
// contract), run on tool calls, prompts, permission requests, compaction and session lifecycle events. Not carried
// over from the V1 plugin yet: blocking a prompt with UserPromptSubmit (the V2 prompt hook has no failure channel)
// and `type: "prompt"` hooks (no small-model access).
export const Plugin = define({
  id: "fork.hooks",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const global = yield* Global.Service

    const load = Effect.fn("ForkHooksPlugin.load")(function* () {
      const own = ForkHooks.parse(Config.latest(yield* config.entries(), "hooks"))
      // FORK-SEAM: cc-plugins-hooks (hooks of enabled Claude Code plugins run after the user's own)
      const plugged = ForkClaudePlugins.enabled()
        ? yield* Effect.promise(() => ForkClaudePlugins.pluginHooks({ home: global.home, cwd: ctx.location.directory }))
        : {}
      return Object.fromEntries(
        ForkHooks.EVENTS.flatMap((event) => {
          const entries = [...(own[event] ?? []), ...(plugged[event] ?? [])]
          return entries.length > 0 ? [[event, entries]] : []
        }),
      ) satisfies ForkHooks.Hooks
    })

    const fire = Effect.fn("ForkHooksPlugin.fire")(function* (
      event: ForkHooks.Event,
      payload: Omit<ForkHooks.Payload, "event" | "cwd">,
      name?: string,
    ) {
      if (!ForkHooks.enabled()) return {} satisfies ForkHooks.Outcome
      // Read per event so config edits apply without a restart.
      const entries = ForkHooks.select(yield* load(), event, name)
      if (!entries.length) return {} satisfies ForkHooks.Outcome
      return yield* Effect.promise(() =>
        ForkHooks.runAll(entries, { ...payload, event, cwd: ctx.location.directory }, (entry, error) =>
          console.warn(`fork-hooks: ${event} hook "${ForkHooks.describe(entry)}": ${error}`),
        ),
      )
    })

    // Tool calls a PreToolUse hook blocked: not a tool failure.
    const blocked = new Set<string>()

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const outcome = yield* fire(
          "PreToolUse",
          { sessionID: event.sessionID, tool: event.tool, args: event.input },
          event.tool,
        )
        if (ForkHooks.blocked(outcome)) {
          blocked.add(event.id)
          return yield* new ToolFailure({ message: outcome.reason || "Blocked by PreToolUse hook" })
        }
        if (outcome.args) event.input = outcome.args
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status === "completed") {
          const outcome = yield* fire(
            "PostToolUse",
            {
              sessionID: event.sessionID,
              tool: event.tool,
              args: event.input,
              output: event.result.content ?? event.result.output,
            },
            event.tool,
          )
          if (outcome.additionalContext) event.result = appendContext(event.result, outcome.additionalContext)
          return
        }
        if (blocked.delete(event.id)) return
        const outcome = yield* fire(
          "PostToolUseFailure",
          { sessionID: event.sessionID, tool: event.tool, args: event.input, error: event.error.message },
          event.tool,
        )
        if (outcome.additionalContext)
          event.error = new ToolFailure({ message: `${event.error.message}\n\n${outcome.additionalContext}` })
      }),
    )

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const outcome = yield* fire("UserPromptSubmit", { sessionID: event.sessionID, prompt: event.prompt.text })
        if (!outcome.additionalContext) return
        event.prompt.text = `${event.prompt.text}\n\n<system-reminder>\n${outcome.additionalContext}\n</system-reminder>`
      }),
    )

    yield* ctx.session.hook("compaction", (event) =>
      Effect.gen(function* () {
        const outcome = yield* fire("PreCompact", { sessionID: event.sessionID })
        if (outcome.additionalContext) event.system.push({ type: "text", text: outcome.additionalContext })
      }),
    )

    // Lifecycle events cannot block; failures of the hook itself are already logged by `fire`.
    const notify = (sessionID: Session.ID, notificationType: string, message: string) =>
      fire("Notification", { sessionID, notificationType, message }, notificationType)

    yield* ctx.event.subscribe().pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "session.created") {
            if (event.data.parentID) return
            const outcome = yield* fire("SessionStart", { sessionID: event.data.sessionID })
            if (!outcome.additionalContext) return
            yield* ctx.session.synthetic({
              sessionID: event.data.sessionID,
              text: `<system-reminder>\n${outcome.additionalContext}\n</system-reminder>`,
              resume: false,
            })
            return
          }
          if (event.type === "session.deleted") {
            yield* fire("SessionEnd", { sessionID: event.data.sessionID, reason: "deleted" })
            return
          }
          if (event.type === "session.execution.succeeded") {
            const session = yield* ctx.session.get({ sessionID: event.data.sessionID })
            if (session.parentID) {
              yield* fire("SubagentStop", {
                sessionID: event.data.sessionID,
                parentID: session.parentID,
                agent: session.agent,
              })
              return
            }
            yield* Effect.all([
              fire("Stop", { sessionID: event.data.sessionID }),
              notify(event.data.sessionID, "idle", "Session is idle and waiting for input"),
            ])
            return
          }
          if (event.type === "permission.asked") {
            yield* notify(
              event.data.sessionID,
              "permission",
              `Permission requested: ${event.data.action} ${event.data.resources.join(" ")}`.trim(),
            )
            return
          }
          if (event.type === "form.created") {
            yield* notify(event.data.form.sessionID as Session.ID, "question", event.data.form.title)
          }
        }).pipe(
          Effect.catchCause((cause) => Effect.logWarning("fork-hooks: lifecycle hook failed", { cause })),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        const outcome = yield* fire(
          "PermissionRequest",
          {
            sessionID: event.sessionID,
            permission: { type: event.action, pattern: event.resources, metadata: event.metadata },
          },
          event.action,
        )
        if (!outcome.decision) return
        event.effect = outcome.decision === "block" ? "deny" : outcome.decision
        if (outcome.reason) event.message = outcome.reason
      }),
    )
  }),
})

function appendContext(result: Tool.Result, text: string): Tool.Result {
  const content = result.content
  if (content === undefined) return { ...result, content: text }
  if (typeof content === "string") return { ...result, content: `${content}\n\n${text}` }
  return { ...result, content: [...content, { type: "text", text }] }
}
