import { ForkFlags } from "@opencode-fork/core/flags"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ForkRoute } from "@opencode-fork/core/route"
import type { Info, Model } from "./provider"

// The virtual "router" provider: router/auto and router/<tier> show up in /models next to the
// connected providers. They are never sent anywhere. Each turn the session resolves the virtual
// model to a concrete one (session/fork-route.ts), and the assistant message records that one.
export const ID = "router"

export const enabled = () => ForkFlags.on("ROUTE")

export const isRouter = (providerID: string) => providerID === ID

const NAMES = {
  auto: "Auto",
  fast: "Fast",
  standard: "Standard",
  reasoning: "Reasoning",
  frontier: "Frontier",
} as const

// Added after the providers are loaded, only when something real is connected.
export function inject(providers: Record<string, Info>, disabled: ReadonlySet<string>) {
  if (!enabled() || disabled.has(ID) || providers[ID] || Object.keys(providers).length === 0) return
  const providerID = ProviderV2.ID.make(ID)
  const flags = { text: true, audio: false, image: true, video: false, pdf: true }
  const models = ForkRoute.MODEL_IDS.map((id): Model => {
    return {
      id: ModelV2.ID.make(id),
      providerID,
      api: { id, url: "", npm: "@opencode-fork/router" },
      name: NAMES[id],
      family: "router",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: flags,
        output: { ...flags, image: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 200_000, output: 32_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "",
      variants: {},
    }
  })
  providers[providerID] = {
    id: providerID,
    name: "Router",
    source: "custom",
    env: [],
    options: {},
    models: Object.fromEntries(models.map((model) => [model.id, model])),
  }
}

// Last concrete model each session's virtual model resolved to. Consumers that are handed the virtual model
// instead of the turn's concrete one (title, compaction, hooks) run on it through `getLanguage`. Keyed by session:
// two sessions on router/auto at once resolve to different models. The per-virtual entry is the fallback for a
// caller that has no session (a process restart also leaves the session map empty).
const bySession = new Map<string, { providerID: string; modelID: string }>()
const byVirtual = new Map<string, { providerID: string; modelID: string }>()
const MAX_SESSIONS = 200

export function remember(virtual: string, real: { providerID: string; modelID: string }, sessionID?: string) {
  byVirtual.set(virtual, real)
  if (!sessionID) return
  bySession.delete(sessionID)
  bySession.set(sessionID, real)
  const oldest = bySession.size > MAX_SESSIONS ? bySession.keys().next().value : undefined
  if (oldest !== undefined) bySession.delete(oldest)
}

export function concrete(model: { providerID: string; id: string }, sessionID?: string) {
  if (!isRouter(model.providerID)) return undefined
  return (sessionID ? bySession.get(sessionID) : undefined) ?? byVirtual.get(model.id) ?? byVirtual.get("auto")
}
export * as ForkRouteProvider from "./fork-route"
