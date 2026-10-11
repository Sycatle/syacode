import { expect, test } from "bun:test"
import os from "os"
import path from "path"

process.env.OPENCODE_FORK_DB = path.join(os.tmpdir(), `fork-handoff-${process.pid}-${Date.now()}.db`)
const { ForkHandoff } = await import("../src/handoff")
const { ForkHandoffLog } = await import("../src/handoff-log")

const cp = ForkHandoff.build({
  time: 1,
  session_id: "ses_1",
  reason: "failover",
  from: "anthropic/claude-opus-5-5",
  to: "openai/gpt-6.1-sol",
  context: 180_000,
  facts: { files: ["src/a.ts"], todos: [{ content: "write tests", status: "pending" }], errors: [] },
  git: "branch fix, 2 files changed",
  request: `  ${"x".repeat(5000)}  `,
})

test("a checkpoint is needed for a real provider change of a large conversation only", () => {
  expect(ForkHandoff.needed({ from: "anthropic/a", to: "openai/b", context: 50_000 }, 20_000)).toBe(true)
  expect(ForkHandoff.needed({ from: "anthropic/a", to: "anthropic/b", context: 50_000 }, 20_000)).toBe(false)
  expect(ForkHandoff.needed({ from: "anthropic/a", to: "openai/b", context: 5_000 }, 20_000)).toBe(false)
  expect(ForkHandoff.needed({ to: "openai/b", context: 50_000 }, 20_000)).toBe(false)
})

test("the last request is cut, and the rendering is plain Markdown", () => {
  expect(cp.request.length).toBeLessThan(4_100)
  const text = ForkHandoff.render(cp)
  expect(text).toContain("failover, anthropic/claude-opus-5-5 to openai/gpt-6.1-sol, ~180k tokens")
  expect(text).toContain("- src/a.ts")
  expect(text).toContain("- [pending] write tests")
  expect(text).toContain("branch fix")
})

test("the minimum reads the environment", () => {
  expect(ForkHandoff.minTokens({})).toBe(20_000)
  expect(ForkHandoff.minTokens({ OPENCODE_FORK_HANDOFF_MIN: "0" })).toBe(0)
  expect(ForkHandoff.minTokens({ OPENCODE_FORK_HANDOFF_MIN: "abc" })).toBe(20_000)
})

test("a checkpoint is stored and read back", () => {
  ForkHandoffLog.record(cp)
  const found = ForkHandoffLog.latest("ses_1")
  expect(found?.row).toMatchObject({ reason: "failover", from_model: "anthropic/claude-opus-5-5", context: 180_000 })
  expect(found?.checkpoint.facts.files).toEqual(["src/a.ts"])
  expect(ForkHandoffLog.latest("ses_2")).toBeUndefined()
})
