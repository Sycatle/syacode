import { ForkCache } from "@opencode-fork/core/cache"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ForkJev } from "@opencode-fork/core/jev"
import { ForkQuota } from "@opencode-fork/core/quota"
import { ForkRouteHealth } from "@opencode-fork/core/route-health"
import { ForkHandoff } from "@opencode-fork/core/handoff"
import { ForkRoute } from "@opencode-fork/core/route"
import { ForkProviderRoute } from "@opencode-fork/core/route-provider"
import { ForkRouteGlobal } from "@opencode-fork/core/route-global"
import { ForkRouteJev } from "@opencode-fork/core/route-jev"
import { ForkRouteLog } from "@opencode-fork/core/route-log"
import { Cause, Effect, Option, Schema } from "effect"
import { Provider } from "@/provider/provider"
import { ForkRouteProvider } from "@/provider/fork-route"
import { smallModelRun } from "./fork-small-model"
import { PartID } from "./schema"
import type { Session } from "./session"
import { SessionRetry } from "./retry"

// Router, session side. At each new user message of a router/* session the small model of the
// provider reads the prompt and a short summary and emits signals; the pure policy in
// @opencode-fork/core/route picks a tier and a concrete model; the choice is journaled in fork.db.
// Tool loops keep the model. A failure before the first streamed byte puts the model (or its
// provider) in cooldown and the turn is routed again (`failed`, called from the processor).

const health = ForkRoute.health()
health.restore(ForkRouteHealth.load())

// `floor` is the tier a struggling turn was raised to: it holds for every later step of the same message.
type Turn = { candidates: string[]; attempts: number; excluded: Set<string>; error?: string; floor?: ForkRoute.Tier }
const turns = new Map<string, Turn>()

const parseJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

const MAX_REROUTES = 4
// System prompt and tool definitions of a session that has not run a turn yet.
const FIXED_CONTEXT = 12_000
// The first small-model call of a process pays the provider's cold start; once one answered, a slow call
// costs the user more than routing on default signals does.
const SIGNALS_TIMEOUT_COLD = "20 seconds"
const SIGNALS_TIMEOUT_WARM = "5 seconds"
let signalsWarm = false

export type Resolved = { providerID: ProviderV2.ID; modelID: ModelV2.ID }

export const routed = (user: SessionV1.User) => ForkRouteProvider.isRouter(user.model.providerID)

export const resolve = Effect.fn("ForkRouteTurn.resolve")(function* (input: {
  session: Session.Info
  user: SessionV1.User
  messages: SessionV1.WithParts[]
  assistant: SessionV1.Assistant | undefined
}) {
  const own: Resolved = { providerID: input.user.model.providerID, modelID: input.user.model.modelID }
  if (!routed(input.user)) return yield* pinned(input, own)

  const provider = yield* Provider.Service
  const mode = ForkRoute.parseMode(input.user.model.modelID) ?? ({ kind: "auto" } as const)
  const connected = Object.values(yield* provider.list()).filter((item) => !ForkRouteProvider.isRouter(item.id))
  const models = new Map<string, Provider.Model>(
    connected.flatMap((item) => Object.values(item.models).map((model) => [`${item.id}/${model.id}`, model] as const)),
  )
  // One snapshot per subscription: each provider is judged on its own window, not on whichever is fresh first.
  const quotas = ["anthropic", "openai"].flatMap((id) => ForkQuota.fresh(id) ?? [])
  const headrooms = new Map(quotas.map((item) => [item.provider, headroomOf(item)] as const))
  const catalog = catalogOf(models, headrooms)
  const now = Date.now()

  const done = ForkRouteLog.forMessage(input.session.id, input.user.id)
  const continuation = done !== undefined || input.assistant?.parentID === input.user.id
  const turn = turns.get(input.user.id) ?? { candidates: [], attempts: 0, excluded: new Set<string>() }
  const view = sessionView(input, catalog, done)

  const assistants = input.messages.flatMap((m) => (m.info.role === "assistant" && m.info.tokens ? [m.info] : []))
  const lastTurn = assistants.findLast((m) => m.tokens.input + m.tokens.cache.read + m.tokens.cache.write > 0)
  const prompt = textOf(input.messages.findLast((m) => m.info.id === input.user.id))
  const context = lastTurn
    ? lastTurn.tokens.input + lastTurn.tokens.cache.read + lastTurn.tokens.cache.write + lastTurn.tokens.output
    : FIXED_CONTEXT
  const tokens = context + Math.ceil(prompt.length / 4)

  // Over a subscription's 5-hour threshold (or rejected): its provider goes last, for new messages only.
  const threshold = ForkRoute.quotaThreshold(process.env.OPENCODE_FORK_ROUTE_QUOTA)
  const overQuota = continuation
    ? []
    : quotas
        .filter(
          (item) =>
            item.five_hour !== undefined &&
            item.five_hour.reset > now &&
            (item.five_hour.utilization >= threshold || item.status === "rejected"),
        )
        .map((item) => item.provider)
  const degraded = new Set([...health.degraded(now), ...turn.excluded, ...overQuota])

  // A short follow-up keeps the confident signals of the previous message instead of classifying again.
  const latest = ForkRouteLog.decisions(input.session.id, 1)[0]
  const before = latest?.signals ? ForkRoute.readSignals(Option.getOrUndefined(parseJson(latest.signals))) : undefined
  const reused =
    mode.kind === "auto" &&
    !continuation &&
    latest !== undefined &&
    before !== undefined &&
    !ForkRoute.shouldReclassify({ prompt, previous: { signals: before, time: latest.time }, now })
  const needsClassify = mode.kind === "auto" && !continuation && !reused
  const signals = reused
    ? { ...before, context_size: ForkRoute.contextSize(tokens), source: "reused" as const }
    : needsClassify
      ? yield* classify({
          models,
          catalog,
          degraded,
          view,
          sessionID: input.session.id,
          prompt,
          tokens,
          messages: input.messages,
          user: input.user,
        })
      : undefined

  // A turn whose tool calls keep failing moves up one tier for the rest of the message.
  const calls = input.messages.flatMap((m) =>
    m.info.role === "assistant" && m.info.parentID === input.user.id
      ? m.parts.flatMap((part) => (part.type === "tool" ? [{ status: part.state.status }] : []))
      : [],
  )
  const floor =
    turn.floor ?? (continuation && mode.kind === "auto" && view && ForkRoute.struggling(calls) ? ForkRoute.above(view.tier) : undefined)

  // Coldness and model-switch cost are about the history, cached for five minutes even when the prefix has an hour.
  const ttl = ForkCache.HISTORY_WARM_MS
  const cold = lastTurn?.time.completed !== undefined && now - lastTurn.time.completed > ttl
  const recent = assistants.slice(-5)
  const chooseIn = (scope: ForkRoute.Catalog) =>
    ForkRoute.choose(
      {
        mode,
        minTier: floor,
        signals: signals ?? (needsClassify ? ForkRoute.unknown(ForkRoute.contextSize(tokens)) : undefined),
        continuation,
        session: view,
        tokens,
        needsTools: true,
        degraded,
        context,
        remaining: Number(process.env.OPENCODE_FORK_ROUTE_TURNS) || 6,
        output: recent.length ? recent.reduce((sum, m) => sum + m.tokens.output + m.tokens.reasoning, 0) / recent.length : 1500,
        cold,
        warm: Object.fromEntries(
          assistants
            .filter((m) => m.time.completed !== undefined && now - m.time.completed <= ttl)
            .map((m) => [
              `${m.providerID}/${m.modelID}`,
              m.tokens.input + m.tokens.cache.read + m.tokens.cache.write + m.tokens.output,
            ]),
        ),
      },
      scope,
    )
  // FORK-SEAM: route-global (the provider is chosen first, then the model inside it)
  const chosen = ForkRouteGlobal.enabled()
    ? pickProvider({
        catalog,
        models,
        degraded,
        headrooms,
        view,
        floor,
        mode,
        signals,
        tokens,
        context,
        output: recent.length ? recent.reduce((sum, m) => sum + m.tokens.output + m.tokens.reasoning, 0) / recent.length : 1500,
        continuation,
        cold,
      })
    : undefined
  const choice = (chosen ? chooseIn(ForkProviderRoute.restrict(catalog, chosen.provider)) : undefined) ?? chooseIn(catalog)
  const real = choice ? models.get(choice.model) : undefined
  if (!choice || !real)
    return {
      error: `Router: no connected model can serve this request (~${tokens} tokens, router/${input.user.model.modelID}). Pick a model with /models, or check the provider login with \`opencode auth list\`.`,
    } as const

  const resolved: Resolved = { providerID: real.providerID, modelID: real.id }
  turns.set(input.user.id, {
    ...turn,
    floor,
    candidates: choice.candidates.map((c) => c.model),
  })
  trim()
  ForkRouteProvider.remember(
    input.user.model.modelID,
    { providerID: resolved.providerID, modelID: resolved.modelID },
    input.session.id,
  )

  // A continuation that kept its model is not news; a new decision or a move to another model is.
  const moved = done !== undefined && `${done.provider_id}/${done.model_id}` !== choice.model
  // The effort variant is fixed for the message; it is picked again only for a new message or a new model.
  const variant =
    continuation && !moved
      ? (done?.variant ?? undefined)
      : ForkRoute.effort({
          signals,
          tier: choice.tier,
          available: Object.keys(real.variants ?? {}),
          previous: continuation ? undefined : previousVariant(input.session.id),
          switched: moved || (view !== undefined && view.model !== choice.model),
          cold,
        })
  const fresh = needsClassify || reused ? signals : undefined
  if (continuation && !moved) return { model: resolved, variant, signals: undefined, handoff: undefined } as const
  const escalated = moved && floor !== undefined && turn.error === undefined
  ForkRouteLog.record({
    time: now,
    session_id: input.session.id,
    message_id: input.user.id,
    kind: escalated ? "escalation" : moved ? "fallback" : "decision",
    mode: mode.kind === "auto" ? "auto" : mode.tier,
    tier: choice.tier,
    provider_id: real.providerID,
    model_id: real.id,
    previous: view ? view.model : undefined,
    reason: choice.reason,
    score: choice.score,
    signals,
    error: moved && !escalated ? turn.error : undefined,
    variant,
    provider_reason: chosen?.switched ? chosen.reason : undefined,
  })
  return { model: resolved, variant, signals: fresh, handoff: handoffOf({ from: view?.model, to: choice.model, context, reason: chosen?.reason, session: input.session }) } as const
})

// The variant of the session's last routed message; undefined for a session that has none.
function previousVariant(sessionID: string) {
  const row = ForkRouteLog.latest(sessionID)
  return row ? { variant: row.variant ?? undefined } : undefined
}

// The scarcer of the two windows: the weekly one can close a provider while the 5-hour one looks empty.
function headroomOf(quota: ForkQuota.Snapshot) {
  const used = Math.max(quota.five_hour?.utilization ?? 0, quota.seven_day?.utilization ?? 0)
  return Math.max(0, 1 - used)
}

// `subscriptions` maps each provider served through a subscription to the room left in its windows.
function catalogOf(models: Map<string, Provider.Model>, subscriptions: ReadonlyMap<string, number>): ForkRoute.Catalog {
  const known = [...models].map(([id, model]): ForkRoute.Known => {
    return {
      id,
      provider: model.providerID,
      model: model.id,
      context: model.limit.context,
      tools: model.capabilities.toolcall && model.capabilities.output.text,
      price: {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cache.read,
        cacheWrite: model.cost.cache.write,
      },
      reasoning: model.capabilities.reasoning,
      released: model.release_date,
      subscription: subscriptions.has(model.providerID),
      headroom: subscriptions.get(model.providerID),
    }
  })
  // `OPENCODE_FORK_ROUTE_TIERS` is JSON ({"fast": ["anthropic/claude-haiku-4-5"], ...}) rather than a config key:
  // the config schema is shared with the generated SDK and migrations, which would make every seam wider.
  const forced = ForkRoute.parseTiers(process.env.OPENCODE_FORK_ROUTE_TIERS) ?? {}
  const derived = ForkRoute.deriveTiers(known)
  const ids = new Set(known.map((m) => m.id))
  return {
    models: Object.fromEntries(known.map((m) => [m.id, m])),
    tiers: Object.fromEntries(
      ForkRoute.TIERS.map((tier) => [tier, forced[tier]?.filter((id) => ids.has(id)) ?? derived[tier]]),
    ) as Record<ForkRoute.Tier, string[]>,
  }
}

// A model picked by hand stays, unless its provider is cooling down (rate limit, quota, bad credentials): then the
// turn fails over to the provider the global router ranks first, at the same tier, with a checkpoint when the
// conversation is large. When the provider recovers the user's model is back.
const pinned = Effect.fn("ForkRouteTurn.pinned")(function* (
  input: {
    session: Session.Info
    user: SessionV1.User
    messages: SessionV1.WithParts[]
    assistant: SessionV1.Assistant | undefined
  },
  own: Resolved,
) {
  const stay = { model: own, variant: undefined, signals: undefined, handoff: undefined } as const
  const provider = yield* Provider.Service
  const connected = Object.values(yield* provider.list()).filter((item) => !ForkRouteProvider.isRouter(item.id))
  alternatives = new Set(connected.map((item) => item.id))
  const now = Date.now()
  const open = health.degraded(now)
  if (!ForkRouteGlobal.enabled() || !(open.has(own.providerID) || open.has(`${own.providerID}/${own.modelID}`))) return stay

  const models = new Map<string, Provider.Model>(
    connected.flatMap((item) => Object.values(item.models).map((model) => [`${item.id}/${model.id}`, model] as const)),
  )
  const quotas = ["anthropic", "openai"].flatMap((id) => ForkQuota.fresh(id) ?? [])
  const headrooms = new Map(quotas.map((item) => [item.provider, headroomOf(item)] as const))
  const catalog = catalogOf(models, headrooms)
  const degraded = new Set(health.degraded(now))
  const ownID = `${own.providerID}/${own.modelID}`
  const tier = ForkRoute.TIERS.findLast((t) => catalog.tiers[t].includes(ownID)) ?? "standard"
  const assistants = input.messages.flatMap((m) => (m.info.role === "assistant" && m.info.tokens ? [m.info] : []))
  const lastTurn = assistants.findLast((m) => m.tokens.input + m.tokens.cache.read + m.tokens.cache.write > 0)
  const context = lastTurn ? lastTurn.tokens.input + lastTurn.tokens.cache.read + lastTurn.tokens.cache.write + lastTurn.tokens.output : FIXED_CONTEXT
  const tokens = context + Math.ceil(textOf(input.messages.findLast((m) => m.info.id === input.user.id)).length / 4)
  const output = 1500
  const order = ForkRouteGlobal.failover(own.providerID, {
    tier,
    providers: viewsOf({ catalog, degraded, headrooms, tier, tokens, context, output, task: undefined }),
    context,
  })
  const target = order[0]
  if (!target) return stay
  const choice = ForkRoute.choose(
    {
      mode: { kind: "tier", tier },
      continuation: false,
      tokens,
      needsTools: true,
      degraded,
      context,
      remaining: Number(process.env.OPENCODE_FORK_ROUTE_TURNS) || 6,
      output,
      cold: true,
    },
    ForkProviderRoute.restrict(catalog, target),
  )
  const real = choice ? models.get(choice.model) : undefined
  if (!choice || !real) return stay

  const reason = `${own.providerID} is cooling down: failover to ${target}`
  const done = ForkRouteLog.forMessage(input.session.id, input.user.id)
  if (done?.model_id !== real.id)
    ForkRouteLog.record({
      time: now,
      session_id: input.session.id,
      message_id: input.user.id,
      kind: "fallback",
      mode: "pinned",
      tier: choice.tier,
      provider_id: real.providerID,
      model_id: real.id,
      previous: ownID,
      reason,
      provider_reason: reason,
    })
  return {
    model: { providerID: real.providerID, modelID: real.id },
    variant: undefined,
    signals: undefined,
    handoff: handoffOf({
      from: input.assistant ? `${input.assistant.providerID}/${input.assistant.modelID}` : undefined,
      to: choice.model,
      context,
      reason,
      session: input.session,
    }),
  } as const
})

// Providers connected as of the last turn: a failure of a pinned model can only fail over if another one exists.
let alternatives = new Set<string>()

// The provider the global router sends the turn to. Undefined when it is not involved or nothing can serve the turn,
// in which case the flat router decides over every connected model.
function pickProvider(input: {
  catalog: ForkRoute.Catalog
  models: Map<string, Provider.Model>
  degraded: ReadonlySet<string>
  headrooms: ReadonlyMap<string, number>
  view: ForkRoute.SessionView | undefined
  floor: ForkRoute.Tier | undefined
  mode: ReturnType<typeof ForkRoute.parseMode> | { kind: "auto" }
  signals: ForkRoute.Signals | undefined
  tokens: number
  context: number
  output: number
  continuation: boolean
  cold: boolean
}) {
  const decision = ForkRoute.decide(
    {
      mode: input.mode ?? { kind: "auto" },
      minTier: input.floor,
      signals: input.signals,
      continuation: input.continuation,
      session: input.view,
      tokens: input.tokens,
      needsTools: true,
      degraded: input.degraded,
    },
    input.catalog,
  )
  const providers = viewsOf({
    catalog: input.catalog,
    degraded: input.degraded,
    headrooms: input.headrooms,
    tier: decision.tier,
    tokens: input.tokens,
    context: input.context,
    output: input.output,
    task: input.signals?.task_type,
  })
  return ForkRouteGlobal.pick({
    current: input.view?.provider,
    tier: decision.tier,
    providers,
    continuation: input.continuation,
    cold: input.cold,
    context: input.context,
  })
}

// What the global router knows about each connected provider for this turn.
function viewsOf(input: {
  catalog: ForkRoute.Catalog
  degraded: ReadonlySet<string>
  headrooms: ReadonlyMap<string, number>
  tier: ForkRoute.Tier
  tokens: number
  context: number
  output: number
  task: string | undefined
}) {
  const affinity = ForkRouteGlobal.affinities(process.env.OPENCODE_FORK_ROUTE_AFFINITY)
  const ids = [...new Set(Object.values(input.catalog.models).map((model) => model.provider))]
  return ids.map((id): ForkRouteGlobal.ProviderView => {
    const usable = (tier: ForkRoute.Tier) =>
      input.catalog.tiers[tier]
        .flatMap((model) => (input.catalog.models[model]?.provider === id ? [input.catalog.models[model]] : []))
        .filter((model) => ForkRoute.compatible(model, input.tokens, true))
    const top = ForkRoute.TIERS.findLast((tier) => usable(tier).length > 0)
    const own = usable(input.tier)[0] ?? (top ? usable(top)[0] : undefined)
    return {
      id,
      healthy: !input.degraded.has(id),
      top,
      subscription: input.headrooms.has(id),
      headroom: input.headrooms.get(id) ?? 1,
      turnCost: own ? (input.context * own.price.cacheRead + input.output * own.price.output) / 1_000_000 : Infinity,
      affinity: ForkRouteGlobal.affinityOf(affinity, id, input.task),
    }
  })
}

// A conversation that changes provider leaves behind a checkpoint and a summary (prompt.ts acts on this).
function handoffOf(input: { from: string | undefined; to: string; context: number; reason: string | undefined; session: Session.Info }) {
  if (input.session.parentID || !input.from) return undefined
  if (!ForkHandoff.needed({ from: input.from, to: input.to, context: input.context })) return undefined
  // Once per move: the summary turn that follows runs on the target and must not trigger another.
  if (handedOff.get(input.session.id) === input.to) return undefined
  handedOff.set(input.session.id, input.to)
  return { from: input.from, to: input.to, context: input.context, reason: input.reason ?? "provider changed" } as const
}

const handedOff = new Map<string, string>()

// Whether a provider is out of cooldown; the cached summary replays a request to the provider the conversation
// leaves, which is pointless when that provider is the one that refused.
export const healthy = (providerID: string) => !health.degraded(Date.now()).has(providerID)

// The small model of a parent's provider; while that provider is cooling down, the one of another connected provider
// (an explore subagent must not fail on the provider that just refused the parent).
export const smallModel = Effect.fn("ForkRouteTurn.smallModel")(function* (
  provider: Pick<Provider.Interface, "getSmallModel" | "list">,
  providerID: Provider.Info["id"],
) {
  const own = yield* provider.getSmallModel(providerID)
  if (healthy(providerID) || !ForkRouteGlobal.enabled()) return own
  const others = Object.keys(yield* provider.list()).filter(
    (id) => id !== providerID && !ForkRouteProvider.isRouter(id) && healthy(id),
  )
  for (const id of others) {
    const small = yield* provider.getSmallModel(id as Provider.Info["id"])
    if (small) return small
  }
  return own
})

// Where the session stands: the journal first, then the last assistant message of a session
// whose earlier turns ran on a model picked by hand. A new session or a subagent has no view.
function sessionView(
  input: { session: Session.Info; assistant: SessionV1.Assistant | undefined },
  catalog: ForkRoute.Catalog,
  done: ForkRouteLog.Row | undefined,
): ForkRoute.SessionView | undefined {
  const history = ForkRouteLog.decisions(input.session.id, 3)
  const latest = done ?? ForkRouteLog.latest(input.session.id)
  if (latest)
    return {
      tier: (history[0] ?? latest).tier,
      model: `${latest.provider_id}/${latest.model_id}`,
      provider: latest.provider_id,
      history: history.map((row) => row.tier).toReversed(),
    }
  const last = input.assistant
  if (input.session.parentID || !last || ForkRouteProvider.isRouter(last.providerID)) return undefined
  const id = `${last.providerID}/${last.modelID}`
  const tier = ForkRoute.TIERS.findLast((t) => catalog.tiers[t].includes(id)) ?? "standard"
  return { tier, model: id, provider: last.providerID, history: [] }
}

function textOf(message: SessionV1.WithParts | undefined) {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === "text" && !part.synthetic && !part.ignored ? [part.text] : []))
    .join("\n")
}

const classify = Effect.fn("ForkRouteTurn.classify")(function* (input: {
  models: Map<string, Provider.Model>
  catalog: ForkRoute.Catalog
  degraded: ReadonlySet<string>
  view: ForkRoute.SessionView | undefined
  sessionID: string
  prompt: string
  tokens: number
  messages: SessionV1.WithParts[]
  user: SessionV1.User
}) {
  const first = input.messages.find((m) => m.info.role === "user")
  const lastAnswer = input.messages.findLast((m) => m.info.role === "assistant")
  const summary: ForkRoute.Summary = {
    first: first && first.info.id !== input.user.id ? textOf(first) : undefined,
    messages: input.messages.length,
    tokens: input.tokens,
    lastAnswer: textOf(lastAnswer) || undefined,
  }
  const size = ForkRoute.contextSize(input.tokens)

  // Jev first when TYPESAFE_API_KEY is set; any failure falls back to the small model below.
  if (ForkRouteJev.enabled()) {
    const jev = yield* Effect.promise((signal) => ForkRouteJev.call({ prompt: input.prompt, summary, size, signal }))
    ForkJev.journal({
      feature: "route",
      session_id: input.sessionID,
      ms: jev.ms,
      ok: !!jev.signals,
      error: jev.error,
      decision: jev.signals?.task_type,
    })
    if (jev.signals) {
      yield* Effect.logInfo("router signals", { source: "jev", ms: jev.ms })
      return { ...jev.signals, source: "jev" } as const
    }
    yield* Effect.logWarning("router signals", { source: "small-model", jev_error: jev.error, ms: jev.ms })
  }

  // The small model of the provider the turn is most likely to run on.
  const home =
    input.view?.model ??
    input.catalog.tiers.standard.find((id) => !input.degraded.has(id)) ??
    input.catalog.tiers.standard[0]
  const base = input.models.get(home ?? "")
  if (!base) return undefined
  const text = yield* smallModelRun({
    prompt: ForkRoute.signalsPrompt(input.prompt, summary),
    current: { providerID: base.providerID, modelID: base.id },
    noThinking: true,
    maxOutputTokens: 200,
  }).pipe(
    Effect.map((result) => result.text),
    Effect.timeout(signalsWarm ? SIGNALS_TIMEOUT_WARM : SIGNALS_TIMEOUT_COLD),
    Effect.tap(() => Effect.sync(() => (signalsWarm = true))),
    Effect.catchCause((cause) =>
      Effect.logWarning("router signals failed", { cause: Cause.pretty(cause).slice(0, 500) }).pipe(Effect.as(undefined)),
    ),
  )
  const signals = text === undefined ? undefined : ForkRoute.parseSignals(text, size)
  if (text !== undefined && !signals) yield* Effect.logWarning("router signals unreadable", { text: text.slice(0, 300) })
  if (signals) yield* Effect.logInfo("router signals", { source: "small-model" })
  return signals && ({ ...signals, source: "small-model" } as const)
})

// Adds the plan-mode reminder to the latest user message once, when the Router's signals call for it.
export const planNudge = Effect.fn("ForkRouteTurn.planNudge")(function* (input: {
  sessions: Session.Interface
  messages: SessionV1.WithParts[]
  signals: ForkRoute.Signals | undefined
  agent: string
  root: boolean
  available: boolean
}) {
  const user = input.messages.findLast((m) => m.info.role === "user")
  if (!user || user.parts.some((part) => part.type === "text" && part.metadata?.forkPlanNudge)) return
  if (!ForkRoute.planNudge({ signals: input.signals, agent: input.agent, root: input.root, available: input.available }))
    return
  user.parts.push(
    yield* input.sessions.updatePart({
      id: PartID.ascending(),
      messageID: user.info.id,
      sessionID: user.info.sessionID,
      type: "text",
      text: ForkRoute.PLAN_NUDGE,
      synthetic: true,
      metadata: { forkPlanNudge: true },
    }),
  )
})

// ---------------------------------------------------------------- fallback

// Signals the processor that this attempt must be routed again (never reaches the user).
export const REROUTE = new Error("fork-route-reroute")

// An event that carries model output: from then on the turn cannot move to another model.
export const output = (type: string) => /^(text|reasoning|tool)-/.test(type)

// A provider call of a router/* turn failed before streaming anything. Puts the model (or its
// provider, when quota or credits ran out) in cooldown and returns true when the turn should be
// routed again because another candidate is left. Otherwise the session's own retry and error
// handling apply, as for any model.
export function failed(input: { user: SessionV1.User; model: Provider.Model; error: SessionRetry.Err }) {
  if (!routed(input.user)) return failedPinned(input)
  const turn = turns.get(input.user.id)
  if (!turn || turn.attempts >= MAX_REROUTES) return false
  const failure = failureOf(input.error, input.model.providerID)
  if (!failure) return false
  const id = `${input.model.providerID}/${input.model.id}`
  const cooled = health.record({ id, provider: input.model.providerID }, failure, Date.now())
  const until = cooled ? health.until(cooled) : undefined
  if (cooled && until) ForkRouteHealth.save(cooled, until)
  turn.excluded.add(id)
  turn.attempts++
  turn.error = `${id}: ${failure.kind}`
  const open = health.degraded(Date.now())
  const alternative = turn.candidates.some(
    (candidate) => !turn.excluded.has(candidate) && !open.has(candidate) && !open.has(candidate.split("/")[0]),
  )
  return alternative
}

// A model picked by hand fails over only when waiting cannot help: quota, credits or credentials are gone, or the
// provider kept answering 429/529 through several tries of the same message. Other failures keep the session's retries.
const PINNED_RATE_LIMITED_TRIES = 3

function failedPinned(input: { user: SessionV1.User; model: Provider.Model; error: SessionRetry.Err }) {
  if (!ForkRouteGlobal.enabled()) return false
  const failure = failureOf(input.error, input.model.providerID)
  if (!failure) return false
  const turn = turns.get(input.user.id) ?? { candidates: [], attempts: 0, excluded: new Set<string>() }
  turns.set(input.user.id, turn)
  trim()
  turn.attempts++
  const hard = failure.kind === "quota" || failure.kind === "auth"
  if (!hard && !(failure.kind === "rate_limited" && turn.attempts >= PINNED_RATE_LIMITED_TRIES)) return false
  if (turn.attempts > MAX_REROUTES) return false
  const key = health.record({ id: `${input.model.providerID}/${input.model.id}`, provider: input.model.providerID }, failure, Date.now())
  const until = key ? health.until(key) : undefined
  if (key && until) ForkRouteHealth.save(key, until)
  return [...alternatives].some((id) => id !== input.model.providerID && !health.degraded(Date.now()).has(id))
}

function failureOf(error: SessionRetry.Err, provider: string) {
  if (SessionV1.ContextOverflowError.isInstance(error)) return undefined
  if (SessionV1.APIError.isInstance(error)) {
    const headers = error.data.responseHeaders ?? {}
    const ms = Number.parseFloat(headers["retry-after-ms"] ?? "")
    const seconds = Number.parseFloat(headers["retry-after"] ?? "")
    return ForkRoute.classify({
      status: error.data.statusCode,
      message: `${error.data.message} ${error.data.responseBody ?? ""}`,
      retryAfterMs: Number.isFinite(ms) ? ms : Number.isFinite(seconds) ? seconds * 1000 : undefined,
    })
  }
  // Network errors and the like: whatever the session would retry is a transient failure here.
  return SessionRetry.retryable(error, provider) ? ({ kind: "transient" } as const) : undefined
}

// The router model a subagent of this session should run on, when the session's current turn is routed:
// the subagent is a new session, so it starts from the tier its own prompt calls for.
export function subagent(sessionID: string, running: { providerID: string; modelID: string }) {
  const row = ForkRouteLog.latest(sessionID)
  if (!row || row.provider_id !== running.providerID || row.model_id !== running.modelID) return undefined
  return { providerID: ForkRouteProvider.ID, modelID: row.mode }
}

function trim() {
  if (turns.size <= 200) return
  const oldest = turns.keys().next().value
  if (oldest !== undefined) turns.delete(oldest)
}

export * as ForkRouteTurn from "./fork-route"
