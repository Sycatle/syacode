import { ForkFlags } from "./flags"
import type { Tier } from "./route"
import { TIERS } from "./route"

// The global level of the Router: which provider serves the turn. It runs before the per-provider router
// (route-provider.ts), which then picks the model inside the chosen provider.
//
// A model's prompt cache belongs to the model (probe of 11 Oct 2026, Anthropic and OpenAI), so any change of
// provider rewrites the whole prefix. The default is therefore to stay, and to move only when something outweighs
// that: the current provider cannot serve the turn, its subscription window is nearly spent while another has room,
// or the conversation is so small (or its cache so cold) that moving costs nothing.

export function enabled() {
  return ForkFlags.on("ROUTE_GLOBAL")
}

export type ProviderView = {
  id: string
  // Not in cooldown (rate limit, quota, bad credentials).
  healthy: boolean
  // Highest tier one of its models can serve for this request (context window and tools considered); undefined if none.
  top?: Tier
  // Served through a subscription: the marginal cost of a turn is zero while the window has room.
  subscription: boolean
  // Share of the subscription windows still free, 0..1; 1 when unknown or billed by usage.
  headroom: number
  // USD per turn of the model it would run, for this context (cache read + output). Compared between API-billed providers.
  turnCost: number
  // Weight of the provider for the task, 0..1 (OPENCODE_FORK_ROUTE_AFFINITY); 0.5 when unset.
  affinity: number
}

export type Input = {
  // The provider of the previous turn; undefined for a new session.
  current?: string
  // Tier the turn needs (from the per-provider decision on the best candidate).
  tier: Tier
  providers: readonly ProviderView[]
  // Inside a tool loop: only a hard failure moves the turn.
  continuation: boolean
  // The prompt cache expired: a move rewrites nothing that would not be rewritten anyway.
  cold: boolean
  // Tokens in the conversation.
  context: number
}

export type Pick = { provider: string; reason: string; switched: boolean }

// Below this share of free window a provider is under pressure; another one needs at least RELIEF to take over.
export const PRESSURE = 0.15
export const RELIEF = 0.4
// A conversation this small is rewritten in one cheap request.
export const SMALL_CONTEXT = 20_000
// Affinity must beat the current provider by this much, and only where a move is cheap.
export const AFFINITY_MARGIN = 0.2

export function pick(i: Input): Pick | undefined {
  const can = (view: ProviderView) => view.healthy && view.top !== undefined && rank(view.top) >= rank(i.tier)
  const eligible = i.providers.filter(can)
  if (!eligible.length) return undefined
  const current = i.providers.find((view) => view.id === i.current)

  if (!current || !can(current)) {
    const best = best_(eligible)
    const reason = !current
      ? `new session on ${best.id}`
      : !current.healthy
        ? `${current.id} is cooling down: failover to ${best.id}`
        : `${current.id} cannot serve ${i.tier}: moved to ${best.id}`
    return { provider: best.id, reason, switched: current !== undefined }
  }

  const stay = { provider: current.id, reason: `stay on ${current.id}: its cache is warm`, switched: false }
  if (i.continuation) return { ...stay, reason: `tool loop: stay on ${current.id}` }

  const others = eligible.filter((view) => view.id !== current.id)
  const relief = others.filter((view) => view.headroom >= RELIEF).toSorted(compare)[0]
  if (current.subscription && current.headroom < PRESSURE && relief)
    return {
      provider: relief.id,
      reason: `${current.id} window ${percent(1 - current.headroom)} spent, ${relief.id} has ${percent(relief.headroom)} free`,
      switched: true,
    }

  const cheap = i.cold || i.context <= SMALL_CONTEXT
  if (!cheap) return stay
  const better = others.filter((view) => view.affinity >= current.affinity + AFFINITY_MARGIN).toSorted(compare)[0]
  if (better)
    return {
      provider: better.id,
      reason: `${better.id} suits the task better (${better.affinity.toFixed(2)} vs ${current.affinity.toFixed(2)}) and a move is cheap`,
      switched: true,
    }
  return stay
}

// Subscription with the most room first, then the cheapest turn, then the provider name (stable).
function compare(a: ProviderView, b: ProviderView) {
  return (
    Number(b.subscription) - Number(a.subscription) ||
    bucket(b.headroom) - bucket(a.headroom) ||
    b.affinity - a.affinity ||
    a.turnCost - b.turnCost ||
    a.id.localeCompare(b.id)
  )
}

function best_(views: readonly ProviderView[]) {
  return views.toSorted(compare)[0]
}

// Fifths, so a few points of difference never reorder providers.
const bucket = (headroom: number) => Math.floor(headroom * 5)
const percent = (value: number) => `${Math.round(value * 100)}%`
const rank = (tier: Tier) => TIERS.indexOf(tier)

// The providers other than `failing` that could take over a turn, best first; empty when none can.
export function failover(failing: string, input: Omit<Input, "current" | "continuation" | "cold">) {
  return input.providers
    .filter(
      (view) => view.id !== failing && view.healthy && view.top !== undefined && rank(view.top) >= rank(input.tier),
    )
    .toSorted(compare)
    .map((view) => view.id)
}

// OPENCODE_FORK_ROUTE_AFFINITY: {"anthropic": {"architecture": 0.9}, "openai": {"tests": 0.8}}. Unlisted pairs are 0.5.
export function affinities(text: string | undefined): Record<string, Record<string, number>> {
  if (!text) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([provider, tasks]) =>
        typeof tasks === "object" && tasks !== null
          ? [
              [
                provider,
                Object.fromEntries(
                  Object.entries(tasks).flatMap(([task, weight]) =>
                    typeof weight === "number" && weight >= 0 && weight <= 1 ? [[task, weight]] : [],
                  ),
                ),
              ],
            ]
          : [],
      ),
    )
  } catch {
    return {}
  }
}

export function affinityOf(table: Record<string, Record<string, number>>, provider: string, task: string | undefined) {
  return (task ? table[provider]?.[task] : undefined) ?? 0.5
}

export * as ForkRouteGlobal from "./route-global"
