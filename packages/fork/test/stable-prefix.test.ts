import { expect, test } from "bun:test"
import { ForkStablePrefix } from "../src/stable-prefix"

test("only Claude models that bind thinking blocks get a stable tool list, unless switched off", () => {
  delete process.env.OPENCODE_FORK_STABLE_PREFIX
  expect(ForkStablePrefix.enabled(true)).toBe(true)
  expect(ForkStablePrefix.enabled(false)).toBe(false)
  process.env.OPENCODE_FORK_STABLE_PREFIX = "0"
  expect(ForkStablePrefix.enabled(true)).toBe(false)
  delete process.env.OPENCODE_FORK_STABLE_PREFIX
})

test("the plan and worktree tools stay listed, other denied tools are still hidden", () => {
  const hidden = ForkStablePrefix.hidden(new Set(["plan_exit", "enter_worktree", "bash", "question"]))
  expect([...hidden].toSorted()).toEqual(["bash", "question"])
})

test("a refused call names the tool and the agent", () => {
  expect(ForkStablePrefix.refusal("plan_exit", "build")).toContain("plan_exit is not available to the build agent")
})

test("freeze keeps the first system of a session until its history starts over", () => {
  const key = { session: "ses_freeze", agent: "build", model: "claude-opus-5-5", first: { role: "user", content: "hi" } }
  expect(ForkStablePrefix.freeze(key, ["monday"])).toEqual(["monday"])
  expect(ForkStablePrefix.freeze(key, ["tuesday"])).toEqual(["monday"])
  expect(ForkStablePrefix.freeze({ ...key, agent: "plan" }, ["tuesday"])).toEqual(["tuesday"])
  expect(ForkStablePrefix.freeze({ ...key, first: { role: "user", content: "summary" } }, ["tuesday"])).toEqual(["tuesday"])
})
