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
