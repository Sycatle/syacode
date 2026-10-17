import { ForkBudget } from "@opencode-fork/core/budget"
import { ForkPromptSuggestion } from "@opencode-fork/core/prompt-suggestion"
import { ForkQuota } from "@opencode-fork/core/quota"
import { ForkSummary } from "@opencode-fork/core/summary"
import { ForkTelemetry } from "@opencode-fork/core/telemetry"
import { ForkFleet } from "@/session/fork-fleet"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

// FORK-SEAM: fork-api

export const forkHandlers = HttpApiBuilder.group(InstanceHttpApi, "fork", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return handlers
      .handle("fleet", (ctx) =>
        Effect.gen(function* () {
          const live = ForkFleet.list()
          const running = live.size
            ? yield* sessions.listGlobal({
                ids: [...live.keys()] as SessionID[],
                roots: ctx.query.roots,
                archived: ctx.query.archived,
                limit: live.size,
              })
            : []
          const recent =
            ctx.query.active
              ? []
              : yield* sessions.listGlobal({
                  roots: ctx.query.roots,
                  archived: ctx.query.archived,
                  search: ctx.query.search,
                  limit: ctx.query.limit ?? 100,
                })
          const known = new Set<string>(running.map((session) => session.id))
          return [...running, ...recent.filter((session) => !known.has(session.id))]
            .map((session) => {
              const entry = live.get(session.id)
              return { session, status: entry?.status ?? "idle", waiting: entry?.waiting.size ?? 0 }
            })
            .sort(
              (a, b) =>
                rank(a) - rank(b) || b.session.time.updated - a.session.time.updated,
            )
        }),
      )
      .handle("suggestion", (ctx) =>
        Effect.sync(() => {
          const enabled = ForkPromptSuggestion.enabled() && ForkPromptSuggestion.userEnabled()
          const row = enabled ? ForkPromptSuggestion.latest(ctx.params.sessionID) : undefined
          return { enabled, messageID: row?.message_id, text: row?.text ?? undefined }
        }),
      )
      .handle("usage", (ctx) =>
        Effect.sync(() => {
          const steps = ForkTelemetry.steps(ctx.params.sessionID, { children: true })
          const summary = ForkSummary.summarize(steps, ctx.params.sessionID)
          // The quota belongs to the provider of the latest turn. A session without a turn yet shows the
          // subscription in use; one whose provider has no fresh snapshot (API key) has none.
          const provider = steps.findLast((step) => step.session_id === ctx.params.sessionID)?.provider_id
          const snapshot = provider ? ForkQuota.fresh(provider) : ForkQuota.active()
          return {
            ...summary,
            quota: snapshot && {
              provider: snapshot.provider,
              status: snapshot.status,
              time: snapshot.time,
              fiveHour: snapshot.five_hour,
              sevenDay: snapshot.seven_day,
              windowSpent: ForkQuota.windowSpent(ctx.params.sessionID, snapshot.provider),
            },
            budget: { usd: ForkBudget.limit(), window: ForkBudget.windowLimit() },
          }
        }),
      )
  }),
)

// Waiting on the user first, then running, then the rest.
function rank(entry: { status: string; waiting: number }) {
  if (entry.waiting > 0) return 0
  return entry.status === "idle" ? 2 : 1
}
