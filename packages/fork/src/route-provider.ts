import type { Catalog, Tier } from "./route"
import { TIERS } from "./route"

// The Router in two levels. ForkRouteGlobal picks the provider; the per-provider router below picks the model, the
// tier and the effort inside it. Each provider is described by what it is known to do, so the global level never
// assumes that every provider behaves like Anthropic.

export type Capabilities = {
  // What a prompt cache entry belongs to. "model": switching model in the same provider rewrites the whole prefix.
  cacheScope: "model" | "provider" | "none"
  // Measured with a probe (same prefix, two models of the provider), or assumed because nothing was measured.
  measured: boolean
  // Signed thinking blocks are bound to the prefix: a changed prefix drops them, a foreign provider cannot read them.
  signedThinking: boolean
  // The provider runs the deferred-tool search itself (tool_search_tool_*): its blocks mean nothing elsewhere.
  nativeToolSearch: boolean
}

// Probe of 11 Oct 2026: request 1 writes, 2 reads, then the other model of the provider reads nothing and writes the
// whole prefix, and the first model is still warm afterwards. Both providers behave the same way.
const KNOWN: Record<string, Capabilities> = {
  anthropic: { cacheScope: "model", measured: true, signedThinking: true, nativeToolSearch: true },
  openai: { cacheScope: "model", measured: true, signedThinking: false, nativeToolSearch: false },
}

// An unmeasured provider is assumed to cache per model: the pessimistic case only makes a switch look dearer.
const UNKNOWN: Capabilities = { cacheScope: "model", measured: false, signedThinking: false, nativeToolSearch: false }

export function capabilities(provider: string): Capabilities {
  return KNOWN[provider] ?? UNKNOWN
}

// Does moving from one model to another keep the prompt cache? Only a "provider"-scoped cache survives a model
// change inside its provider; nothing survives a change of provider.
export function keepsCache(from: { provider: string; model: string }, to: { provider: string; model: string }) {
  if (from.provider !== to.provider) return false
  if (from.model === to.model) return true
  return capabilities(from.provider).cacheScope === "provider"
}

// The catalog seen by one provider's router: its models only, tiers rebuilt without the others. A tier the provider
// does not cover borrows its nearest populated one, like the global tiers do, so routing inside it never dead-ends.
export function restrict(catalog: Catalog, provider: string): Catalog {
  const own = (id: string) => catalog.models[id]?.provider === provider
  const raw = Object.fromEntries(TIERS.map((tier) => [tier, (catalog.tiers[tier] ?? []).filter(own)])) as Record<
    Tier,
    string[]
  >
  const tiers = Object.fromEntries(
    TIERS.map((tier, index) => {
      if (raw[tier].length) return [tier, raw[tier]]
      const below = TIERS.slice(0, index)
        .toReversed()
        .find((t) => raw[t].length)
      const above = TIERS.slice(index + 1).find((t) => raw[t].length)
      const from = below ?? above
      return [tier, from ? raw[from] : []]
    }),
  ) as Record<Tier, string[]>
  return {
    models: Object.fromEntries(Object.entries(catalog.models).filter(([id]) => own(id))),
    tiers,
  }
}

export * as ForkProviderRoute from "./route-provider"
