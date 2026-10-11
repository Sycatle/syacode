import { expect, test } from "bun:test"
import os from "os"
import path from "path"

process.env.OPENCODE_FORK_DB = path.join(os.tmpdir(), `fork-route-health-${process.pid}-${Date.now()}.db`)
const { ForkRouteHealth } = await import("../src/route-health")

test("a cooldown is read back until it ends, then dropped", () => {
  ForkRouteHealth.save("openai", 10_000)
  ForkRouteHealth.save("anthropic/claude-haiku-4-5", 2_000)
  expect(ForkRouteHealth.load(1_000).map((entry) => entry.key).toSorted()).toEqual(["anthropic/claude-haiku-4-5", "openai"])
  expect(ForkRouteHealth.load(5_000)).toEqual([{ key: "openai", until: 10_000 }])
})
