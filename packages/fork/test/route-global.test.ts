import { expect, test } from "bun:test"
import { ForkRouteGlobal } from "../src/route-global"

const view = (id: string, over: Partial<ForkRouteGlobal.ProviderView> = {}): ForkRouteGlobal.ProviderView => ({
  id,
  healthy: true,
  top: "frontier",
  subscription: true,
  headroom: 1,
  turnCost: 0.1,
  affinity: 0.5,
  ...over,
})

const base = { tier: "standard" as const, continuation: false, cold: false, context: 150_000 }

test("a new session starts on the subscription with the most room", () => {
  const pick = ForkRouteGlobal.pick({ ...base, providers: [view("openai", { headroom: 0.3 }), view("anthropic", { headroom: 0.9 })] })
  expect(pick).toMatchObject({ provider: "anthropic", switched: false })
})

test("the current provider stays while it is healthy, even when another is cheaper", () => {
  const pick = ForkRouteGlobal.pick({
    ...base,
    current: "anthropic",
    providers: [view("anthropic", { turnCost: 1 }), view("openai", { turnCost: 0.01 })],
  })
  expect(pick).toMatchObject({ provider: "anthropic", switched: false })
})

test("a provider in cooldown or unable to serve the tier is left", () => {
  const providers = [view("anthropic", { healthy: false }), view("openai")]
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", providers })).toMatchObject({ provider: "openai", switched: true })
  const weak = [view("anthropic", { top: "fast" }), view("openai")]
  expect(ForkRouteGlobal.pick({ ...base, tier: "reasoning", current: "anthropic", providers: weak })).toMatchObject({ provider: "openai" })
})

test("a tool loop only moves on a hard failure", () => {
  const providers = [view("anthropic", { headroom: 0.05 }), view("openai")]
  expect(ForkRouteGlobal.pick({ ...base, continuation: true, current: "anthropic", providers })?.provider).toBe("anthropic")
  const down = [view("anthropic", { healthy: false }), view("openai")]
  expect(ForkRouteGlobal.pick({ ...base, continuation: true, current: "anthropic", providers: down })?.provider).toBe("openai")
})

test("a nearly spent window moves work only to a provider with real room", () => {
  const spent = view("anthropic", { headroom: 0.05 })
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", providers: [spent, view("openai", { headroom: 0.6 })] })).toMatchObject({
    provider: "openai",
    switched: true,
  })
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", providers: [spent, view("openai", { headroom: 0.3 })] })?.provider).toBe(
    "anthropic",
  )
})

test("task affinity moves a conversation only where a move is cheap", () => {
  const providers = [view("anthropic", { affinity: 0.4 }), view("openai", { affinity: 0.9 })]
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", providers })?.provider).toBe("anthropic")
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", cold: true, providers })?.provider).toBe("openai")
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", context: 5_000, providers })?.provider).toBe("openai")
  const close = [view("anthropic", { affinity: 0.5 }), view("openai", { affinity: 0.6 })]
  expect(ForkRouteGlobal.pick({ ...base, current: "anthropic", cold: true, providers: close })?.provider).toBe("anthropic")
})

test("nothing can serve the turn", () => {
  expect(ForkRouteGlobal.pick({ ...base, providers: [view("anthropic", { healthy: false })] })).toBeUndefined()
})

test("failover lists the other healthy providers, best first", () => {
  const providers = [view("anthropic"), view("openai", { headroom: 0.2 }), view("google", { healthy: false }), view("xai", { subscription: false })]
  expect(ForkRouteGlobal.failover("anthropic", { tier: "standard", providers, context: 1000 })).toEqual(["openai", "xai"])
})

test("affinity weights are read defensively", () => {
  const table = ForkRouteGlobal.affinities('{"anthropic":{"architecture":0.9,"tests":"x"},"openai":5}')
  expect(table).toEqual({ anthropic: { architecture: 0.9 } })
  expect(ForkRouteGlobal.affinityOf(table, "anthropic", "architecture")).toBe(0.9)
  expect(ForkRouteGlobal.affinityOf(table, "openai", "tests")).toBe(0.5)
  expect(ForkRouteGlobal.affinities("not json")).toEqual({})
})
