import { expect, test } from "bun:test"
import type { Catalog } from "../src/route"
import { ForkProviderRoute } from "../src/route-provider"

const price = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }
const model = (provider: string, name: string) => ({ id: `${provider}/${name}`, provider, model: name, context: 200_000, tools: true, price })
const catalog: Catalog = {
  models: Object.fromEntries(
    [model("anthropic", "haiku"), model("anthropic", "opus"), model("openai", "luna")].map((item) => [item.id, item]),
  ),
  tiers: {
    fast: ["anthropic/haiku", "openai/luna"],
    standard: ["openai/luna"],
    reasoning: ["anthropic/opus"],
    frontier: ["anthropic/opus"],
  },
}

test("the provider's catalog holds its models only, and an empty tier borrows the nearest one", () => {
  const openai = ForkProviderRoute.restrict(catalog, "openai")
  expect(Object.keys(openai.models)).toEqual(["openai/luna"])
  expect(openai.tiers).toEqual({
    fast: ["openai/luna"],
    standard: ["openai/luna"],
    reasoning: ["openai/luna"],
    frontier: ["openai/luna"],
  })
  const anthropic = ForkProviderRoute.restrict(catalog, "anthropic")
  expect(anthropic.tiers.standard).toEqual(["anthropic/haiku"])
  expect(anthropic.tiers.frontier).toEqual(["anthropic/opus"])
})

test("capabilities are measured for Anthropic and OpenAI, assumed for the others", () => {
  expect(ForkProviderRoute.capabilities("anthropic")).toMatchObject({ cacheScope: "model", measured: true, signedThinking: true })
  expect(ForkProviderRoute.capabilities("openai")).toMatchObject({ cacheScope: "model", measured: true, nativeToolSearch: false })
  expect(ForkProviderRoute.capabilities("google")).toMatchObject({ cacheScope: "model", measured: false })
})

test("only the same model keeps a per-model cache", () => {
  const haiku = { provider: "anthropic", model: "haiku" }
  expect(ForkProviderRoute.keepsCache(haiku, haiku)).toBe(true)
  expect(ForkProviderRoute.keepsCache(haiku, { provider: "anthropic", model: "opus" })).toBe(false)
  expect(ForkProviderRoute.keepsCache(haiku, { provider: "openai", model: "luna" })).toBe(false)
})
